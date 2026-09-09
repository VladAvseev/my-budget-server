import { verifyAccessToken } from '@/modules/_auth/tokens.js';
import { AppError } from '@/shared/appError.js';
import type { NextFunction, Request, Response } from 'express';

/**
 * Извлекает и проверяет access-токен из заголовка `Authorization: Bearer <jwt>`.
 * Это серверный аналог проверки JWT на стороне Supabase (заголовок подставляет
 * supabase-js из сессии) — у Express эту работу выполняет данный middleware.
 *
 * Успех: в `req.user` кладётся { id, role } из токена, дальше идёт `next()`.
 * Провал: 401 через AppError → errorMiddleware отдаёт единый формат `{ error }`.
 *
 * Важно: функция async (проверка JWT в jose возвращает Promise), поэтому все
 * ошибки передаём через `next(err)` — Express 4 не ловит rejected promise сам.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw new AppError('Требуется авторизация', 401);
    }

    // Отбрасываем префикс 'Bearer ' и проверяем подпись/срок JWT.
    const payload = await verifyAccessToken(header.slice('Bearer '.length));

    if (!payload) {
      // Просроченный или поддельный токен. Клиент по 401 должен попробовать
      // refresh-токен (POST /auth/refresh) и повторить запрос — как autoRefreshToken.
      throw new AppError('Сессия истекла, войдите заново', 401);
    }

    req.user = payload;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Надстройка над `authenticate`: пускает только админов (роль из JWT-claim `role`).
 * Аналог серверных проверок `is_admin()` в Supabase RPC-функциях модуля admin.
 * Ставится строго после `authenticate`.
 */
export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) {
    throw new AppError('Требуется авторизация', 401);
  }
  if (req.user.role !== 'admin') {
    throw new AppError('Недостаточно прав', 403);
  }
  next();
}
