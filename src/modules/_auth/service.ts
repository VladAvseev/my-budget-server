import { toPublicUser } from '@/modules/_users/repository.js';
import { AppError } from '@/shared/appError.js';
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

/**
 * Бизнес-логика авторизации: email+password, JWT-сессия с refresh-ротацией.
 * Клиентские вызовы прежнего auth-сервиса
 * signUp/signInWithPassword/refreshSession/signOut/updateUser({password})
 * превращаются в register/login/refresh/logout/updatePassword ниже.
 */

/** Стоимость bcrypt: 10 раундов — разумный дефолт для интерактивного входа. */
const BCRYPT_ROUNDS = 10;

/**
 * Regex email'а скопирован из клиентской RegistrationForm.tsx
 * (client/src/modules/_registration/components/RegistrationForm.tsx),
 * чтобы сервер принимал ровно те же адреса, что пропускает форма.
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Минимальная длина пароля — та же клиентская валидация (6 символов). */
const MIN_PASSWORD_LENGTH = 6;

/**
 * Максимальная длина пароля. bcrypt молча усекает ввод после 72 байт:
 * без этого ограничения пароль длиннее 72 символов «войдёт» по первым 72,
 * что сбивает пользователя с толку и уменьшает фактическую энтропию
 * (аналог GHSA-2cjv-6wg9-f4f3 в Strapi). Для ASCII 1 символ = 1 байт.
 */
const MAX_PASSWORD_LENGTH = 72;

/** TTL access-токена в секундах для ответа клиенту (соответствует ACCESS_TOKEN_TTL = '1h'). */
const ACCESS_TOKEN_TTL_SECONDS = 3600;

/**
 * Ленивый «фиктивный» bcrypt-хэш. Нужен, чтобы при логине с несуществующим
 * email всё равно выполнялось compare(): время ответа одинаковое для
 * «нет такого юзера» и «неверный пароль» — по таймингу нельзя перебирать email'ы.
 */
let dummyHash: string | null = null;
function getDummyHash(): string {
  dummyHash ??= hashSync('not-a-real-password', BCRYPT_ROUNDS);
  return dummyHash;
}

/** Проверка формы email/пароль — тексты ошибок зеркалят маппинг getErrorMessage() клиента. */
function validateCredentials(email: unknown, password: unknown): asserts email is string {
  if (typeof email !== 'string' || !EMAIL_REGEX.test(email)) {
    throw new AppError('Некорректный email', 400);
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new AppError('Пароль должен содержать не менее 6 символов', 400);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new AppError('Пароль не должен превышать 72 символа', 400);
  }
}

export class AuthService {
  /**
   * Регистрация: подтверждения email нет (нет email-инфраструктуры), поэтому
   * сразу логиним пользователя и выдаём пару токенов.
   */
  async register(input: CredentialsInput, meta: RequestMeta): Promise<SessionResponse> {
    validateCredentials(input.email, input.password);

    const passwordHash = await hash(input.password, BCRYPT_ROUNDS);

    let user: UserRow;
    try {
      user = await authRepository.createUser(input.email, passwordHash);
    } catch (err) {
      // 23505 — unique_violation на индексе users.email: тот же смысл,
      // что 'User already registered' у прежнего auth-сервиса (см. errorMessage.ts клиента).
      if ((err as { code?: string }).code === '23505') {
        throw new AppError('Пользователь с таким email уже зарегистрирован', 409);
      }
      throw err;
    }

    return this.createSession(user, meta);
  }

  /** Логин: проверили пароль — создали новую сессию (новое устройство = новая строка). */
  async login(input: CredentialsInput, meta: RequestMeta): Promise<SessionResponse> {
    validateCredentials(input.email, input.password);

    const user = await authRepository.findByEmail(input.email);

    // compare() обязателен и когда юзера нет — см. комментарий про dummyHash.
    const passwordOk = await compare(input.password, user?.password_hash ?? getDummyHash());

    if (!user || !passwordOk) {
      // Одна формулировка на обе причины — не подсказываем, существует ли email.
      throw new AppError('Неверный email или пароль', 401);
    }

    return this.createSession(user, meta);
  }

  /**
   * Обновление сессии по refresh-токену (клиент дергает при истечении access
   * или получает 401 → refresh → повтор запроса; раньше это делал авто-рефреш
   * клиента). Ротация: токен одноразовый — старый отзывается, выдаётся новая
   * пара. Компрометация старого токена из-за этого упирается в 401 «Сессия истекла».
   */
  async refresh(refreshToken: unknown, meta: RequestMeta): Promise<SessionResponse> {
    if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
      throw new AppError('Не передан refresh-токен', 401);
    }

    const session = await authRepository.findActiveSession(hashRefreshToken(refreshToken));
    if (!session) {
      throw new AppError('Сессия истекла, войдите заново', 401);
    }

    await authRepository.revokeRefreshTokenById(session.token_id);
    return this.createSession(session, meta);
  }

  /**
   * Выход: отзыв текущей сессии (остальные устройства живут — выход по scope
   * одной сессии). Ответ всегда 204, даже если токен неизвестен:
   * logout идемпотентен, а «уже вышел» — не информация для атакующего.
   */
  async logout(refreshToken: unknown): Promise<void> {
    if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
      return;
    }
    const session = await authRepository.findActiveSession(hashRefreshToken(refreshToken));
    if (session) {
      await authRepository.revokeRefreshTokenById(session.token_id);
    }
  }

  /**
   * Смена пароля внутри сессии (changePassword в клиенте шлёт только newPassword).
   * После смены отзываем ВСЕ refresh-токены пользователя: другие вкладки/устройства
   * будут вынуждены залогиниться заново. Выданный ранее access-JWT доживёт до своего
   * TTL (1 час) — неотъемлемая особенность stateless JWT.
   */
  async updatePassword(userId: string, input: UpdatePasswordInput): Promise<void> {
    if (typeof input.newPassword !== 'string' || input.newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new AppError('Пароль должен содержать не менее 6 символов', 400);
    }
    if (input.newPassword.length > MAX_PASSWORD_LENGTH) {
      throw new AppError('Пароль не должен превышать 72 символа', 400);
    }

    const passwordHash = await hash(input.newPassword, BCRYPT_ROUNDS);
    await authRepository.updatePasswordHash(userId, passwordHash);
    await authRepository.revokeAllRefreshTokens(userId);
  }

  /**
   * Общая часть register/login/refresh: подписали access-JWT, сгенерировали
   * refresh-токен, сохранили его хэш с метаданными устройства, вернули пару клиенту.
   */
  private async createSession(user: UserRow, meta: RequestMeta): Promise<SessionResponse> {
    const accessToken = await signAccessToken({ id: user.id, role: user.role });
    const refreshToken = generateRefreshToken();

    await authRepository.insertRefreshToken(
      user.id,
      hashRefreshToken(refreshToken),
      meta.userAgent ?? null,
      meta.ip ?? null,
      refreshTokenExpiresAt(),
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      user: toPublicUser(user),
    };
  }
}

export const authService = new AuthService();
