import { pool } from '@/db/pool.js';
import type { PoolClient } from 'pg';
import type { SessionRow, StaleSessionRow } from './types.js';
import type { UserRow } from '@/modules/_users/types.js';

const STALE_SESSION_RETENTION_DAYS = 30;

export class AuthRepository {

  async findByLogin(login: string): Promise<UserRow | null> {
    const { rows } = await pool.query<UserRow>('SELECT * FROM public.users WHERE login = $1', [
      login,
    ]);
    return rows[0] ?? null;
  }

  async createUser(login: string, passwordHash: string, client?: PoolClient): Promise<UserRow> {
    const { rows } = await (client ?? pool).query<UserRow>(
      `INSERT INTO public.users (login, password_hash)
       VALUES ($1, $2)
       RETURNING *`,
      [login, passwordHash],
    );
    return rows[0];
  }

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

  async revokeRefreshTokenById(id: string): Promise<void> {
    await pool.query(
      'UPDATE public.refresh_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL',
      [id],
    );
  }

  async revokeAllRefreshTokens(userId: string): Promise<void> {
    await pool.query(
      'UPDATE public.refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
      [userId],
    );
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await pool.query(
      'UPDATE public.users SET password_hash = $2, updated_at = now() WHERE id = $1',
      [userId, passwordHash],
    );
  }

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

  async resetFailedAttempts(userId: string): Promise<void> {
    await pool.query(
      `UPDATE public.users
          SET failed_login_attempts = 0, locked_until = NULL, updated_at = now()
        WHERE id = $1
          AND (failed_login_attempts > 0 OR locked_until IS NOT NULL)`,
      [userId],
    );
  }

  async findSessionByHash(tokenHash: string): Promise<StaleSessionRow | null> {
    const { rows } = await pool.query<StaleSessionRow>(
      'SELECT user_id, revoked_at FROM public.refresh_tokens WHERE token_hash = $1',
      [tokenHash],
    );
    return rows[0] ?? null;
  }

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
