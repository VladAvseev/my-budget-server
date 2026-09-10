import type { AppError } from '@/shared/appError.js';
import type { NextFunction, Request, Response } from 'express';

export function errorMiddleware(err: AppError, req: Request, res: Response, next: NextFunction) {
  const status = err.status || 500;
  const message = err.message || 'Внутренняя ошибка сервера';

  // 5xx — неожиданные сбои (баги, падение БД): логируем всегда со стеком
  // и контекстом запроса, наружу по-прежнему уходит только текст без деталей.
  // 4xx — ожидаемая валидация/доступ, шуметь в логах не нужно.
  if (status >= 500) {
    // eslint-disable-next-line no-console -- осознанное логирование 5xx
    console.error(`${req.method} ${req.originalUrl} -> ${status}:`, err);
  }

  res.status(status).json({ error: { message, status } });
}
