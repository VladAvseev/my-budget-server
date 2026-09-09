import type { AppError } from '@/shared/appError.js';
import type { NextFunction, Request, Response } from 'express';

export function errorMiddleware(err: AppError, req: Request, res: Response, next: NextFunction) {
  const status = err.status || 500;
  const message = err.message || 'Внутренняя ошибка сервера';

  res.status(status).json({ error: { message, status } });
}
