import { GATING_DOCUMENT_TYPE } from '@/modules/_consent/types.js';
import { consentRepository } from '@/modules/_consent/repository.js';
import { toPublicUser } from '@/modules/_users/repository.js';
import { AppError } from '@/shared/appError.js';
import { logWarn } from '@/shared/logger.js';
import { withTransaction } from '@/shared/transaction.js';
import { compare, hash, hashSync } from 'bcryptjs';
import { authRepository } from './repository.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiresAt,
  signAccessToken,
} from './tokens.js';
import type {
  CredentialsInput,
  RequestMeta,
  SessionResponse,
  UpdatePasswordInput,
} from './types.js';
import type { UserRow } from '@/modules/_users/types.js';

const BCRYPT_ROUNDS = 10;

const LOGIN_REGEX = /^[a-zа-яё0-9_.-]{3,20}$/;

const INVALID_LOGIN_MESSAGE = 'Логин: 3–20 символов: буквы, цифры, _ - .';

const MIN_PASSWORD_LENGTH = 8;

const LEGACY_LOGIN_MIN_LENGTH = 6;

const MAX_PASSWORD_LENGTH = 72;

const ACCESS_TOKEN_TTL_SECONDS = 3600;

const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

const STALE_SESSION_CLEANUP_CHANCE = 1 / 200;

let dummyHash: string | null = null;
function getDummyHash(): string {
  dummyHash ??= hashSync('not-a-real-password', BCRYPT_ROUNDS);
  return dummyHash;
}

function normalizeLogin(login: unknown): string | null {
  if (typeof login !== 'string') {
    return null;
  }
  const value = login.trim().toLowerCase();
  return LOGIN_REGEX.test(value) ? value : null;
}

function validatePassword(
  password: unknown,
  minPasswordLength: number,
): asserts password is string {
  if (typeof password !== 'string' || password.length < minPasswordLength) {
    throw new AppError(`Пароль должен содержать не менее ${minPasswordLength} символов`, 400);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new AppError('Пароль не должен превышать 72 символа', 400);
  }
}

export class AuthService {

  async register(input: CredentialsInput, meta: RequestMeta): Promise<SessionResponse> {
    const login = normalizeLogin(input.login);
    if (login === null) {
      throw new AppError(INVALID_LOGIN_MESSAGE, 400);
    }
    validatePassword(input.password, MIN_PASSWORD_LENGTH);
    if (input.consent !== true) {
      throw new AppError(
        'Необходимо согласие на обработку персональных данных',
        400,
        'CONSENT_REQUIRED',
      );
    }

    const passwordHash = await hash(input.password, BCRYPT_ROUNDS);

    let user: UserRow;
    try {
      user = await withTransaction(async (client) => {
        const version = await consentRepository.getCurrentVersion(
          client,
          GATING_DOCUMENT_TYPE,
        );
        if (!version) {
          throw new AppError('Документ согласия ещё не опубликован. Повторите попытку позже.', 500);
        }
        const created = await authRepository.createUser(login, passwordHash, client);
        await consentRepository.insertEntry(client, {
          userId: created.id,
          ip: meta.ip ?? 'unknown',
          userAgent: meta.userAgent ?? null,
          documentType: GATING_DOCUMENT_TYPE,
          documentVersion: version,
          formId: 'registration',
          action: 'granted',
        });
        return created;
      });
    } catch (err) {

      if ((err as { code?: string }).code === '23505') {
        throw new AppError('Пользователь с таким логином уже зарегистрирован', 409);
      }
      throw err;
    }

    return this.createSession(user, meta);
  }

  async login(input: CredentialsInput, meta: RequestMeta): Promise<SessionResponse> {
    const login = normalizeLogin(input.login);
    if (login === null) {
      throw new AppError(INVALID_LOGIN_MESSAGE, 400);
    }

    validatePassword(input.password, LEGACY_LOGIN_MIN_LENGTH);

    const user = await authRepository.findByLogin(login);

    if (user?.locked_until && new Date(user.locked_until) > new Date()) {
      throw new AppError(
        `Слишком много неудачных попыток входа. Повторите через ${LOCK_MINUTES} минут.`,
        429,
      );
    }

    const passwordOk = await compare(input.password, user?.password_hash ?? getDummyHash());

    if (!user || !passwordOk) {

      if (user) {
        await authRepository.registerFailedAttempt(
          user.id,
          MAX_FAILED_LOGIN_ATTEMPTS,
          LOCK_MINUTES,
        );
      }

      throw new AppError('Неверный логин или пароль', 401);
    }

    await authRepository.resetFailedAttempts(user.id);
    return this.createSession(user, meta);
  }

  async refresh(refreshToken: unknown, meta: RequestMeta): Promise<SessionResponse> {
    if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
      throw new AppError('Не передан refresh-токен', 401);
    }

    const tokenHash = hashRefreshToken(refreshToken);
    const session = await authRepository.findActiveSession(tokenHash);
    if (!session) {
      const stale = await authRepository.findSessionByHash(tokenHash);
      if (stale && stale.revoked_at !== null) {
        await authRepository.revokeAllRefreshTokens(stale.user_id);
        logWarn(
          `Refresh-токен использован повторно (возможна кража): все сессии отозваны. ` +
            `user=${stale.user_id}`,
        );
      }
      throw new AppError('Сессия истекла, войдите заново', 401);
    }

    await authRepository.revokeRefreshTokenById(session.token_id);
    return this.createSession(session, meta);
  }

  async logout(refreshToken: unknown): Promise<void> {
    if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
      return;
    }
    const session = await authRepository.findActiveSession(hashRefreshToken(refreshToken));
    if (session) {
      await authRepository.revokeRefreshTokenById(session.token_id);
    }
  }

  async updatePassword(userId: string, input: UpdatePasswordInput): Promise<void> {
    if (typeof input.newPassword !== 'string' || input.newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new AppError(`Пароль должен содержать не менее ${MIN_PASSWORD_LENGTH} символов`, 400);
    }
    if (input.newPassword.length > MAX_PASSWORD_LENGTH) {
      throw new AppError('Пароль не должен превышать 72 символа', 400);
    }

    const passwordHash = await hash(input.newPassword, BCRYPT_ROUNDS);
    await authRepository.updatePasswordHash(userId, passwordHash);
    await authRepository.revokeAllRefreshTokens(userId);
    await authRepository.resetFailedAttempts(userId);
  }

  private async createSession(user: UserRow, meta: RequestMeta): Promise<SessionResponse> {
    const accessToken = await signAccessToken({ id: user.id, role: user.role });
    const refreshToken = generateRefreshToken();

    await authRepository.insertRefreshToken(
      user.id,
      hashRefreshToken(refreshToken),
      meta.userAgent ?? null,
      refreshTokenExpiresAt(),
    );

    if (Math.random() < STALE_SESSION_CLEANUP_CHANCE) {
      authRepository.cleanupStaleSessions().catch((err: unknown) => {
        process.stderr.write(`Очистка refresh_tokens не удалась: ${(err as Error).message}\n`);
      });
    }

    return {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      user: toPublicUser(user),
    };
  }
}

export const authService = new AuthService();
