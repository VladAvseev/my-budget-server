import { AppError } from '@/shared/appError.js';
import type { NextFunction, Request, Response } from 'express';

interface ParserError {
  status?: number;
  type?: string;
}

export function errorMiddleware(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: {
        message: err.message,
        status: err.status,

        ...(err.code ? { code: err.code } : {}),
      },
    });
    return;
  }

  const parserError = err as ParserError;
  if (parserError.status === 400 && parserError.type === 'entity.parse.failed') {
    res.status(400).json({ error: { message: 'Некорректное тело запроса', status: 400 } });
    return;
  }
  if (parserError.status === 413) {
    res.status(413).json({ error: { message: 'Слишком большой запрос', status: 413 } });
    return;
  }

  if (
    typeof parserError.status === 'number' &&
    parserError.status >= 400 &&
    parserError.status < 500
  ) {
    res.status(parserError.status).json({
      error: { message: 'Некорректный запрос', status: parserError.status },
    });
    return;
  }

  // eslint-disable-next-line no-console -- осознанное логирование неожиданных 5xx
  console.error(`${req.method} ${req.originalUrl} -> 500:`, err);
  res.status(500).json({ error: { message: 'Внутренняя ошибка сервера', status: 500 } });
}
