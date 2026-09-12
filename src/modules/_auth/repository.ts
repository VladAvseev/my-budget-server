import { pool } from '@/db/pool.js';
import type { SessionRow, StaleSessionRow } from './types.js';
import type { UserRow } from '@/modules/_users/types.js';

/** Сколько дней держать отозванные/истёкшие строки refresh_tokens до physical delete. */
const STALE_SESSION_RETENTION_DAYS = 30;

/**
 * Слой доступа к данным авторизации: таблицы `users` и `refresh_tokens`
 * из db/schema.sql. Вся ответственность за контроль доступа — на
 * параметризованных SQL-запросах сервера и middleware авторизации.
 */
export class AuthRepository {
  /**
   * Поиск по email. Колонка citext — поиск регистронезависимый:
   * 'Foo@Mail.COM' и 'foo@mail.com' — один пользователь.
   */
  async findByEmail(email: string): Promise<UserRow | null> {
    const { rows } = await pool.query<UserRow>('SELECT * FROM public.users WHERE email = $1', [
      email,
    ]);
    return rows[0] ?? null;
  }

  /** Создание аккаунта. Дубликат email поймается уникальным индексом (SQLSTATE 23505). */
  async createUser(email: string, passwordHash: string): Promise<UserRow> {
    const { rows } = await pool.query<UserRow>(
      `INSERT INTO public.users (email, password_hash)
       VALUES ($1, $2)
       RETURNING *`,
      [email, passwordHash],
    );
    return rows[0];
  }

  /**
   * Регистрация refresh-токена = создание «сессии» (одна строка = одно
   * устройство). tokenHash — sha256 от токена, сырой токен
   * в базу не попадает никогда.
   */
  async insertRefreshToken(
    userId: string,
    tokenHash: string,
    userAgent: string | null,
    expiresAt: string,
  ): Promise<void> {
    await pool.query(
      `INSERT INTO public.refresh_tokens (user_id, token_hash, user_agent, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [userId, tokenHash, userAgent, expiresAt],
    );
  }

  /**
   * Активная сессия по хэшу refresh-токена: не отозвана и не просрочена.
   * Сразу отдаёт и пользователя — чтобы /auth/refresh не делал второй запрос.
   * Истёкшие/отозванные строки помечаем revoked_at (диагностика, reuse-детекция),
   * физически удаляет их вероятностная cleanupStaleSessions.
   */
  async findActiveSession(tokenHash: string): Promise<SessionRow | null> {
    const { rows } = await pool.query<SessionRow>(
      `SELECT rt.id AS token_id, u.*
       FROM public.refresh_tokens rt
       JOIN public.users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1
         AND rt.revoked_at IS NULL
         AND rt.expires_at > now()`,
      [tokenHash],
    );
    return rows[0] ?? null;
  }

  /** Отзыв одной сессии (logout / ротация refresh). */
  async revokeRefreshTokenById(id: string): Promise<void> {
    await pool.query(
      'UPDATE public.refresh_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL',
      [id],
    );
  }

  /** Отзыв ВСЕХ сессий пользователя — «выйти на всех устройствах» после смены пароля. */
  async revokeAllRefreshTokens(userId: string): Promise<void> {
    await pool.query(
      'UPDATE public.refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
      [userId],
    );
  }

  /** Обновление bcrypt-хэша пароля (сравнение хэшей делается в сервисе). */
  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await pool.query(
      'UPDATE public.users SET password_hash = $2, updated_at = now() WHERE id = $1',
      [userId, passwordHash],
    );
  }

  /**
   * Неудачная попытка входа: атомарно (одним UPDATE, без read-modify-write
   * гонок между параллельными логинами) инкрементирует счётчик users.
   * Если срок предыдущей блокировки истёк — окно начинается заново (1 вместо
   * inf+1). На maxAttempts-й по счёту неудаче ставится locked_until = now() +
   * lockMinutes минут; оба числа уходят параметрами, строк клиента в SQL нет.
   */
  async registerFailedAttempt(
    userId: string,
    maxAttempts: number,
    lockMinutes: number,
  ): Promise<void> {
    await pool.query(
      `WITH cur AS (
         SELECT CASE
                  WHEN locked_until IS NOT NULL AND locked_until <= now() THEN 1
                  ELSE failed_login_attempts + 1
                END AS new_attempts
           FROM public.users
          WHERE id = $1
       )
       UPDATE public.users u
          SET failed_login_attempts = cur.new_attempts,
              locked_until = CASE
                WHEN cur.new_attempts >= $2 THEN now() + make_interval(mins => $3::int)
                ELSE u.locked_until
              END,
              updated_at = now()
         FROM cur
        WHERE u.id = $1`,
      [userId, maxAttempts, lockMinutes],
    );
  }

  /**
   * Сброс блокировки после успешного входа или смены пароля. Условием
   * отсекаем холостые UPDATE: на успешном логине «чистого» аккаунта запрос
   * не трогает строку.
   */
  async resetFailedAttempts(userId: string): Promise<void> {
    await pool.query(
      `UPDATE public.users
          SET failed_login_attempts = 0, locked_until = NULL, updated_at = now()
        WHERE id = $1
          AND (failed_login_attempts > 0 OR locked_until IS NOT NULL)`,
      [userId],
    );
  }

  /**
   * Строка refresh_tokens по хэшу без фильтра активности — для детекции
   * переиспользования (сервис различает «токена нет в природе» и «токен был,
   * но уже повёрнут/отозван»).
   */
  async findSessionByHash(tokenHash: string): Promise<StaleSessionRow | null> {
    const { rows } = await pool.query<StaleSessionRow>(
      'SELECT user_id, revoked_at FROM public.refresh_tokens WHERE token_hash = $1',
      [tokenHash],
    );
    return rows[0] ?? null;
  }

  /**
   * Удаление «омертвевших» записей сессий: отозванные и истёкшие старше
   * STALE_SESSION_RETENTION_DAYS (30-дневный запас для диагностики).
   * Запускается вероятностно из createSession — постоянного крона нет.
   */
  async cleanupStaleSessions(): Promise<void> {
    await pool.query(
      `DELETE FROM public.refresh_tokens
        WHERE (revoked_at IS NOT NULL
                 AND revoked_at < now() - ($1 || ' days')::interval)
           OR (expires_at < now() - ($1 || ' days')::interval)`,
      [String(STALE_SESSION_RETENTION_DAYS)],
    );
  }
}

export const authRepository = new AuthRepository();
