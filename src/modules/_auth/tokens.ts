/**
 * Токены авторизации.
 *
 * Клиент получает пару:
 *   * access-токен  — короткоживущий JWT, кладётся в `Authorization: Bearer ...`
 *                     на каждый запрос к API (живёт 1 час);
 *   * refresh-токен — длинная opaque-строка (30 дней), клиент обменивает её
 *                     на новую пару через POST /auth/refresh (ротация: старый
 *                     токен одноразовый).
 *
 * Пару хранит сам клиент (React) в localStorage и обновляет по истечении
 * access-токена — см. client/src/shared/api/http.ts.
 */
import 'dotenv/config';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { randomBytes, createHash } from 'node:crypto';

/**
 * Секрет подписи JWT берётся из .env (уже был заготовлен в шаблоне).
 * В боевом окружении обязан быть длинным случайным — короткого secrets
 * jose не примет и бросит ошибку на старте, что правильно: сервер не
 * должен работать с небезопасным ключом.
 */
const secretKey = new TextEncoder().encode(process.env.JWT_SECRET);

/** Время жизни access-токена; клиенту отдаётся секундами в `expiresIn`. */
export const ACCESS_TOKEN_TTL = '1h';

/** Время жизни refresh-токена в сутках. */
export const REFRESH_TOKEN_TTL_DAYS = 30;

/** Полезная нагрузка access-токена: стандартный `sub` (id юзера) + роль. */
export interface AccessTokenPayload {
  id: string;
  role: string;
}

/** Подписываем короткий JWT для заголовка Authorization: Bearer. */
export async function signAccessToken(user: { id: string; role: string }): Promise<string> {
  return new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(secretKey);
}

/**
 * Проверяем подпись и срок годности access-токена.
 * Возвращает payload или null (подделка, истёкший, мусорная строка) —
 * различать причины наружу нельзя, чтобы не помогать атакующему.
 */
export async function verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
  try {
    const { payload }: { payload: JWTPayload } = await jwtVerify(token, secretKey);
    // `sub` обязателен — это id пользователя; без него токен считаем мусорным.
    if (typeof payload.sub !== 'string' || typeof payload.role !== 'string') {
      return null;
    }
    return { id: payload.sub, role: payload.role };
  } catch {
    return null;
  }
}

/**
 * Генерация refresh-токена: 48 случайных байт в base64url.
 * Сам токен знает только клиент; в БД (`refresh_tokens.token_hash`) хранится
 * лишь его sha256-хэш — при дампе базы токены окажутся бесполезны.
 */
export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

/** sha256-хэш refresh-токена в hex — этим значением токен ищется в БД. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** ISO-строка смерти refresh-токена на N суток вперёд (пишется в expires_at). */
export function refreshTokenExpiresAt(days: number = REFRESH_TOKEN_TTL_DAYS): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}
