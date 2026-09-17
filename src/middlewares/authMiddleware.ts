import { pool } from '@/db/pool.js';
import { verifyAccessToken } from '@/modules/_auth/tokens.js';
import { AppError } from '@/shared/appError.js';
import type { NextFunction, Request, Response } from 'express';

const ACTIVITY_WINDOW_MS = 15 * 60 * 1000;

const ACTIVITY_CACHE_MAX = 5000;

const activityMarkedAt = new Map<string, number>();

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

      activityMarkedAt.delete(userId);
      process.stderr.write(`Отметка last_active_at не записана: ${(err as Error).message}\n`);
    });
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw new AppError('Требуется авторизация', 401);
    }

    const payload = await verifyAccessToken(header.slice('Bearer '.length));

    if (!payload) {

      throw new AppError('Сессия истекла, войдите заново', 401);
    }

    req.user = payload;
    touchLastActive(payload.id);
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) {
    throw new AppError('Требуется авторизация', 401);
  }
  if (req.user.role !== 'admin') {
    throw new AppError('Недостаточно прав', 403);
  }
  next();
}
