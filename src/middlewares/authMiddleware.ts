import { pool } from '@/db/pool.js';
import { verifyAccessToken } from '@/modules/_auth/tokens.js';
import { AppError } from '@/shared/appError.js';
import type { NextFunction, Request, Response } from 'express';

/** Окно троттлинга активности: не чаще одной записи в 15 минут на пользователя. */
const ACTIVITY_WINDOW_MS = 15 * 60 * 1000;

/** Страховка от разрастания кэша: при переполнении выбрасываем устаревшие записи. */
const ACTIVITY_CACHE_MAX = 5000;

/** userId -> время (мс) последнего обращения к БД с отметкой активности. */
const activityMarkedAt = new Map<string, number>();

/**
 * Отметка активности пользователя (`users.last_active_at`) на любом
 * авторизованном запросе — а не только при создании операции, как это делал
 * триггер в БД (его сознательно убрали: он переставлял дату на now() при
 * любой пакетной загрузке исторических операций).
 *
 * Пишем fire-and-forget: запрос не обязан ждать базу, а сбой отметки не имеет
 * права превращаться в 500 для клиента. От лишних записей защищают два слоя —
 * кэш в памяти процесса и условие `last_active_at < now() - 15 minutes` в самом
 * UPDATE (оно же корректно работает при нескольких инстансах API).
 */
function touchLastActive(userId: string): void {
  const now = Date.now();
  const markedAt = activityMarkedAt.get(userId);

  if (markedAt !== undefined && now - markedAt < ACTIVITY_WINDOW_MS) {
    return;
  }

  if (activityMarkedAt.size >= ACTIVITY_CACHE_MAX) {
    for (const [id, ts] of activityMarkedAt) {
      if (now - ts >= ACTIVITY_WINDOW_MS) {
        activityMarkedAt.delete(id);
      }
    }
  }
  activityMarkedAt.set(userId, now);

  pool
    .query(
      `UPDATE public.users
          SET last_active_at = now()
        WHERE id = $1
          AND (last_active_at IS NULL OR last_active_at < now() - interval '15 minutes')`,
      [userId],
    )
    .catch((err: unknown) => {
      // Снимаем метку, чтобы следующему запросу дать повторить отметку.
      activityMarkedAt.delete(userId);
      process.stderr.write(`Отметка last_active_at не записана: ${(err as Error).message}\n`);
    });
}

/**
 * Извлекает и проверяет access-токен из заголовка `Authorization: Bearer <jwt>`.
 * Единственный вход в авторизованную часть API: принадлежность строк
 * пользователю определяют уже серверные модули по `req.user.id`.
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
      // refresh-токен (POST /auth/refresh) и повторить запрос.
      throw new AppError('Сессия истекла, войдите заново', 401);
    }

    req.user = payload;
    touchLastActive(payload.id);
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Надстройка над `authenticate`: пускает только админов (роль из JWT-claim `role`).
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
