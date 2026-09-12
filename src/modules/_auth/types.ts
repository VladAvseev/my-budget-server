import type { PublicUser, UserRow } from '@/modules/_users/types.js';

/**
 * Типы модуля auth.
 * Формы запросов повторяют то, что клиент передавал в прежний auth-сервис:
 * signUp / signInWithPassword / refreshSession / signOut / updateUser({password}).
 */

/** POST /auth/register и POST /auth/login — как LoginCredentials в клиенте. */
export interface CredentialsInput {
  login: string;
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
 * Набор полей прежней auth-сессии (access + refresh + срок жизни + user),
 * только в camelCase: исторически приходило { access_token, refresh_token, expires_in, user }.
 */
export interface SessionResponse {
  accessToken: string;
  refreshToken: string;
  /** Секунд до истечения access-токена — клиент по нему понимает, когда обновлять. */
  expiresIn: number;
  user: PublicUser;
}

/** Метаданные устройства из запроса — пишутся в refresh_tokens (кто сессию создал). */
export interface RequestMeta {
  userAgent?: string;
}

/** Строка JOIN refresh_tokens + users: активная сессия вместе с её владельцем. */
export type SessionRow = UserRow & { token_id: string };

/**
 * Минимальная строка refresh_tokens для детекции переиспользования: хэш токена
 * найден, но сессия уже не активна (отозвана при ротации либо истекла).
 * revoked_at IS NOT NULL — токен был повёрнут легитимным клиентом, повторная
 * подача того же значения означает, что его кто-то скопировал.
 */
export interface StaleSessionRow {
  user_id: string;
  revoked_at: Date | null;
}
