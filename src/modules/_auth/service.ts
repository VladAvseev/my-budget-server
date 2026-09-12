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
 * Бизнес-логика авторизации: login+password, JWT-сессия с refresh-ротацией.
 * Клиентские вызовы прежнего auth-сервиса
 * signUp/signInWithPassword/refreshSession/signOut/updateUser({password})
 * превращаются в register/login/refresh/logout/updatePassword ниже.
 */

/** Стоимость bcrypt: 10 раундов — разумный дефолт для интерактивного входа. */
const BCRYPT_ROUNDS = 10;

/**
 * Набор допустимых символов логина и диапазон длины зеркалят клиентский
 * shared/utils/validateLogin.ts: сервер должен принимать ровно то, что
 * пропускают формы входа/регистрации. Поиск и уникальность — через citext
 * (регистронезависимо), поэтому проверяем уже нормализованное значение.
 */
const LOGIN_REGEX = /^[a-zа-яё0-9_.-]{3,20}$/;

/** Окончание как у домена почты: «ivanov.com» в логахинах не приветствуется. */
const EMAIL_TLD_SUFFIX_REGEX = /\.(com|ru|by|net|org)$/;

/** Телефон после вычитания разделителей: подряд 6+ цифр без букв. */
const PHONE_LIKE_REGEX = /^\d{6,}$/;

/** Длинная «только цифры» последовательность внутри логина (номер телефона/карты). */
const LONG_DIGIT_RUN_REGEX = /\d{10,}/;

/**
 * Единый текст отказа валидации (по требованию продукта не различает почту,
 * телефон и ФИО), в том же формулировании — в клиентском validateLogin.ts.
 */
const INVALID_LOGIN_MESSAGE = 'Логин не должен быть почтой, ФИО или телефоном';

/**
 * Минимальная длина НОВОГО пароля (регистрация и смена). С 2026-09 поднята с
 * 6 до 8: шестизначные пароли подбираются распределённым ботнетом даже при
 * per-IP лимите. Синхронизировано с клиентскими RegistrationForm и
 * ChangePasswordModal.
 */
const MIN_PASSWORD_LENGTH = 8;

/**
 * Нижний порог длины пароля ПРИ ВХОДЕ. Существующие аккаунты с паролем
 * 6–7 символов (валидировались до повышения порога) должны сохранять
 * возможность залогиниться — иначе ужесточение выгнала бы их из системы.
 */
const LEGACY_LOGIN_MIN_LENGTH = 6;

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
 * Временная блокировка аккаунта (в БД, колонки users.failed_login_attempts /
 * users.locked_until): столько неудачных попыток входа подряд, после чего
 * вход запрещён на LOCK_MINUTES. per-IP лимит (authRateLimitMiddleware,
 * 5/15 мин) от этого независим — вместе они закрывают и «ботнет по одному
 * аккаунту», и «перебор разных логинов с одного адреса».
 * Счётчик в БД, а не в памяти процесса: блок переживает рестарт/деплой контейнера.
 */
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

/**
 * Вероятность чистки мёртвых refresh-токенов на одну созданную сессию: строки
 * после logout/ротации/истечения раньше только помечались — таблица росла
 * бесконечно. Вероятностный запуск — по образцу maybeCleanupOldLogs
 * в requestLoggingMiddleware (постоянного крона в контейнере нет).
 */
const STALE_SESSION_CLEANUP_CHANCE = 1 / 200;

/**
 * Ленивый «фиктивный» bcrypt-хэш. Нужен, чтобы при логине с несуществующим
 * логином всё равно выполнялось compare(): время ответа одинаковое для
 * «нет такого юзера» и «неверный пароль» — по таймингу нельзя перебирать логины.
 */
let dummyHash: string | null = null;
function getDummyHash(): string {
  dummyHash ??= hashSync('not-a-real-password', BCRYPT_ROUNDS);
  return dummyHash;
}

/**
 * Нормализация и валидация логина: trim + нижний регистр, затем regex
 * допустимых символов и блоки «почта/ФИО/телефон» (ФИО отсекается запретом
 * пробелов). null — логин недопустим; нормализованное значение — тот вид,
 * в котором он уходит в БД (в нижнем регистре — как его же ищет citext).
 */
function normalizeLogin(login: unknown): string | null {
  if (typeof login !== 'string') {
    return null;
  }
  const value = login.trim().toLowerCase();
  if (!LOGIN_REGEX.test(value)) {
    return null;
  }
  if (EMAIL_TLD_SUFFIX_REGEX.test(value)) {
    return null;
  }
  if (PHONE_LIKE_REGEX.test(value.replace(/[-._\s]/g, ''))) {
    return null;
  }
  if (LONG_DIGIT_RUN_REGEX.test(value)) {
    return null;
  }
  return value;
}

/** Проверка пароля — тексты ошибок зеркалят маппинг getErrorMessage() клиента. */
function validatePassword(password: unknown, minPasswordLength: number): asserts password is string {
  if (typeof password !== 'string' || password.length < minPasswordLength) {
    throw new AppError(`Пароль должен содержать не менее ${minPasswordLength} символов`, 400);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new AppError('Пароль не должен превышать 72 символа', 400);
  }
}

export class AuthService {
  /**
   * Регистрация: подтверждения контакта нет (email-инфраструктуры в проекте
   * никогда не было), поэтому сразу логиним пользователя и выдаём пару токенов.
   */
  async register(input: CredentialsInput, meta: RequestMeta): Promise<SessionResponse> {
    const login = normalizeLogin(input.login);
    if (login === null) {
      throw new AppError(INVALID_LOGIN_MESSAGE, 400);
    }
    validatePassword(input.password, MIN_PASSWORD_LENGTH);

    const passwordHash = await hash(input.password, BCRYPT_ROUNDS);

    let user: UserRow;
    try {
      user = await authRepository.createUser(login, passwordHash);
    } catch (err) {
      // 23505 — unique_violation на индексе users.login: тот же смысл,
      // что 'User already registered' у прежнего auth-сервиса (см. errorMessage.ts клиента).
      if ((err as { code?: string }).code === '23505') {
        throw new AppError('Пользователь с таким логином уже зарегистрирован', 409);
      }
      throw err;
    }

    return this.createSession(user, meta);
  }

  /**
   * Логин: проверили пароль — создали новую сессию (новое устройство = новая строка).
   *
   * Временная блокировка аккаунта (после MAX_FAILED_LOGIN_ATTEMPTS неудач —
   * LOCK_MINUTES минут): per-IP лимит не спасает от распределённого ботнета,
   * который долбит ОДИН аккаунт с сотен адресов. Счётчик живёт в БД
   * (users.failed_login_attempts / locked_until), состояние блока — на аккаунт,
   * а не на процесс API. Сообщение о блоке раскрывает существование логина —
   * осознанно: enum уже доступен через register (409 «уже зарегистрирован»),
   * скрывать поздно, а легитимному пользователю нужно объяснять причину.
   */
  async login(input: CredentialsInput, meta: RequestMeta): Promise<SessionResponse> {
    const login = normalizeLogin(input.login);
    if (login === null) {
      throw new AppError(INVALID_LOGIN_MESSAGE, 400);
    }
    // Вход принимаем и за legacy-пароли 6–7 символов (порог 8 — только для новых).
    validatePassword(input.password, LEGACY_LOGIN_MIN_LENGTH);

    const user = await authRepository.findByLogin(login);

    // Блокировка проверяется до bcrypt: не тратим CPU на заведомо отбитые попытки.
    if (user?.locked_until && new Date(user.locked_until) > new Date()) {
      throw new AppError(
        `Слишком много неудачных попыток входа. Повторите через ${LOCK_MINUTES} минут.`,
        429,
      );
    }

    // compare() обязателен и когда юзера нет — см. комментарий про dummyHash.
    const passwordOk = await compare(input.password, user?.password_hash ?? getDummyHash());

    if (!user || !passwordOk) {
      // Юзера нет — блокировать нечего (нечего и красть), per-IP лимит хватает;
      // счётчик ведём только по реальным аккаунтам.
      if (user) {
        await authRepository.registerFailedAttempt(
          user.id,
          MAX_FAILED_LOGIN_ATTEMPTS,
          LOCK_MINUTES,
        );
      }
      // Одна формулировка на обе причины — не подсказываем, существует ли логин.
      throw new AppError('Неверный логин или пароль', 401);
    }

    await authRepository.resetFailedAttempts(user.id);
    return this.createSession(user, meta);
  }

  /**
   * Обновление сессии по refresh-токену (клиент дергает при истечении access
   * или получает 401 → refresh → повтор запроса; раньше это делал авто-рефреш
   * клиента). Ротация: токен одноразовый — старый отзывается, выдаётся новая
   * пара.
   *
   * Детекция переиспользования: повторно присланный уже повёрнутый (отозванный)
   * токен легитимный клиент прислать не может (он свой «потратил» и получил
   * новый) — почти наверняка токен украден (XSS, чужой ПК). Реакция: отзыв
   * ВСЕЙ семьи сессий пользователя (цепочка вора умирает вместе с легитимными
   * устройствами — перезалогин цена остановки тихого захвата) + warning в
   * stderr для админа. Наружу — общий 401, без различий «токена нет» и «reuse».
   */
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
        // eslint-disable-next-line no-console -- сигнал компрометации, должен попадать в stderr/логи контейнера
        console.warn(
          `Refresh-токен использован повторно (возможна кража): все сессии отозваны. ` +
            `user=${stale.user_id}`,
        );
      }
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
   * Заодно снимаем блокировку входа: пользователь доказал владение аккаунтом.
   */
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

  /**
   * Общая часть register/login/refresh: подписали access-JWT, сгенерировали
   * refresh-токен, сохранили его хэш с метаданными устройства, вернули пару
   * клиенту. Здесь же вероятностная чистка мёртвых сессий
   * (см. STALE_SESSION_CLEANUP_CHANCE).
   */
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
