import { pool } from '@/db/pool.js';
import type { SessionRow } from './types.js';
import type { UserRow } from '@/modules/_users/types.js';

/**
 * Слой доступа к данным авторизации: таблицы `users` и `refresh_tokens`
 * из db/schema.sql. В Supabase за это отвечала GoTrue (auth.users) и RLS;
 * здесь вся ответственность — на параметризованных SQL-запросах сервера.
 */
export class AuthRepository {
  /**
   * Поиск по email. Колонка citext — поиск регистронезависимый,
   * как в GoTrue: 'Foo@Mail.COM' и 'foo@mail.com' — один пользователь.
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
   * Регистрация refresh-токена = создание «сессии» (одна строка = одно устройство),
   * как устройства в аккаунте Supabase. tokenHash — sha256 от токена, сырой токен
   * в базу не попадает никогда.
   */
  async insertRefreshToken(
    userId: string,
    tokenHash: string,
    userAgent: string | null,
    ip: string | null,
    expiresAt: string,
  ): Promise<void> {
    await pool.query(
      `INSERT INTO public.refresh_tokens (user_id, token_hash, user_agent, ip, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, tokenHash, userAgent, ip, expiresAt],
    );
  }

  /**
   * Активная сессия по хэшу refresh-токена: не отозвана и не просрочена.
   * Сразу отдаёт и пользователя — чтобы /auth/refresh не делал второй запрос.
   * Истёкшие/отозванные строки не удаляем, а помечаем revoked_at: пригодится
   * для диагностики и «список устройств» в будущем.
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
}

export const authRepository = new AuthRepository();
