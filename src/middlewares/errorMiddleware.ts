import { AppError } from '@/shared/appError.js';
import type { NextFunction, Request, Response } from 'express';

/** Форма ошибки из body-parser (express.json): текст англоязычный, наружу не пускаем. */
interface ParserError {
  status?: number;
  type?: string;
}

/**
 * Единая точка выдачи ошибок. Принципы:
 *   * AppError — ожидаемые ошибки бизнес-логики (валидация, доступ): их текст
 *     русский и предназначен пользователю, отдаём как есть;
 *   * ошибки парсинга тела (некорректный JSON, превышение лимита размера) —
 *     штатные 4xx, но текст тела-parser'а светит внутренности библиотеки,
 *     заменяем на русские формулировки;
 *   * всё остальное — неожиданные сбои (баги, ошибки pg): наружу уходит только
 *     общая формулировка, имена таблиц/констрейнтов из текста pg — это
 *     бесплатная разведка для атакующего; полный текст со стеком — в stderr.
 */
export function errorMiddleware(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { message: err.message, status: err.status } });
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
  // Прочие 4xx от библиотек (например, entity.encoding.unsupported у express.json):
  // статус честный, но текст англоязычный — отдаём нейтральный русский.
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
