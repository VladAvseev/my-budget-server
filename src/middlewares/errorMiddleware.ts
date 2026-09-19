import { AppError } from '@/shared/appError.js';
import {
  getRealErrorMessage,
  INTERNAL_SERVER_ERROR_MESSAGE,
  logServerError,
} from '@/shared/logger.js';
import type { NextFunction, Request, Response } from 'express';

interface ParserError {
  status?: number;
  type?: string;
}

export function errorMiddleware(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    if (err.status >= 500) {
      // Внутренняя ошибка: клиенту — общий текст, настоящее сообщение — в логи
      // (stderr + request_logs.error через res.locals).
      logServerError(req, err);
      res.locals.serverError = getRealErrorMessage(err);
      res.status(500).json({ error: { message: INTERNAL_SERVER_ERROR_MESSAGE, status: 500 } });
      return;
    }
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

  logServerError(req, err);
  res.locals.serverError = getRealErrorMessage(err);
  res.status(500).json({ error: { message: INTERNAL_SERVER_ERROR_MESSAGE, status: 500 } });
}
