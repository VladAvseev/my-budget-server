import type { PublicUser, UserRow } from '@/modules/_users/types.js';

/**
 * Типы модуля auth.
 * Формы запросов повторяют то, что клиент передавал в supabase.auth.*
 * (см. client/src/shared/supabase/services/auth.ts):
 * signUp / signInWithPassword / refreshSession / signOut / updateUser({password}).
 */

/** POST /auth/register и POST /auth/login — как LoginCredentials в клиенте. */
export interface CredentialsInput {
  email: string;
  password: string;
}

/** POST /auth/refresh и POST /auth/logout. */
export interface RefreshTokenInput {
  refreshToken: string;
}

/** PATCH /auth/password — клиентский ChangePasswordModal шлёт только новый пароль. */
export interface UpdatePasswordInput {
  newPassword: string;
}

/**
 * Ответ /auth/register, /auth/login, /auth/refresh.
 * Набор тот же, что у Supabase-сессии (access + refresh + срок жизни + user),
 * только в camelCase: Supabase отдавал { access_token, refresh_token, expires_in, user }.
 */
export interface SessionResponse {
  accessToken: string;
  refreshToken: string;
  /** Секунд до истечения access-токена — клиент по нему понимает, когда обновлять. */
  expiresIn: number;
  user: PublicUser;
}

/** Метаданные устройства из запроса — пишутся в refresh_tokens (кто/откуда сессию создал). */
export interface RequestMeta {
  userAgent?: string;
  ip?: string;
}

/** Строка JOIN refresh_tokens + users: активная сессия вместе с её владельцем. */
export type SessionRow = UserRow & { token_id: string };
