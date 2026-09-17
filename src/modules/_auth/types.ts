import type { PublicUser, UserRow } from '@/modules/_users/types.js';

export interface CredentialsInput {
  login: string;
  password: string;
  consent?: boolean;
}

export interface RefreshTokenInput {
  refreshToken: string;
}

export interface UpdatePasswordInput {
  newPassword: string;
}

export interface SessionResponse {
  accessToken: string;
  refreshToken: string;

  expiresIn: number;
  user: PublicUser;
}

export interface RequestMeta {
  userAgent?: string;

  ip?: string;
}

export type SessionRow = UserRow & { token_id: string };

export interface StaleSessionRow {
  user_id: string;
  revoked_at: Date | null;
}
