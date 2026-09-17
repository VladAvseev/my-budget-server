import 'dotenv/config';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { randomBytes, createHash } from 'node:crypto';

const secretKey = new TextEncoder().encode(process.env.JWT_SECRET);

export const ACCESS_TOKEN_TTL = '1h';

export const REFRESH_TOKEN_TTL_DAYS = 30;

export interface AccessTokenPayload {
  id: string;
  role: string;
}

export async function signAccessToken(user: { id: string; role: string }): Promise<string> {
  return new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(secretKey);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
  try {
    const { payload }: { payload: JWTPayload } = await jwtVerify(token, secretKey);

    if (typeof payload.sub !== 'string' || typeof payload.role !== 'string') {
      return null;
    }
    return { id: payload.sub, role: payload.role };
  } catch {
    return null;
  }
}

export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function refreshTokenExpiresAt(days: number = REFRESH_TOKEN_TTL_DAYS): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}
