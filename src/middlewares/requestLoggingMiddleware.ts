import { pool } from '@/db/pool.js';
import type { NextFunction, Request, Response } from 'express';

/**
 * Логирование HTTP-запросов в таблицу public.request_logs.
 *
 * Что пишется: метод, путь, query, тело запроса, статус, длительность,
 * тело ответа / текст ошибки, user_id (если уже аутентифицирован), ip,
 * user-agent. Тело ответа перехватывается обёрткой над res.json/res.send,
 * длительность считается до res.finish.
 *
 * Безопасность:
 *   * поля password/newPassword/refreshToken в телах маскируются '***';
 *   * заголовок Authorization в базу не попадает;
 *   * тела и ответ урезаются до ~4 КБ;
 *   * логирование НЕ блокирует запрос: вставка fire-and-forget, ошибка
 *     записи выводится в stderr и не влияет на ответ клиенту;
 *   * не логируем сами эндпоинты просмотра логов и health — чтобы
 *     админская статистика не шумела сама от себя.
 *
 * Настройки (.env, с дефолтами ниже):
 *   LOG_BODIES=false         — не писать тела запроса/ответа;
 *   LOG_RETENTION_DAYS=30    — сколько дней хранить логи.
 */

/** Сколько дней держим строки в request_logs. */
const RETENTION_DAYS = Number(process.env.LOG_RETENTION_DAYS) || 30;

/** Писать ли тела запроса/ответа в лог. */
const LOG_BODIES = process.env.LOG_BODIES !== 'false';

/** Максимальный размер сохраняемого тела (символов JSON-строки). */
const BODY_LIMIT = 4096;

/** Путь, которые не логируем (просмотр логов, health-check). */
const SKIPPED_PATHS = new Set(['/api/v1/health']);

/** Ключи тел, значения которых маскируются перед записью в лог. */
const SENSITIVE_KEYS = new Set(['password', 'newpassword', 'refreshtoken']);

/** Рекурсивная маскировка чувствительных полей в JSON-подобном объекте. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function maskSensitive(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(maskSensitive);
  }
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? '***' : maskSensitive(item);
    }
    return result;
  }
  return value;
}

/** JSON-строка с ограничением длины; null — «нечего хранить». */
function truncateJson(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const text = JSON.stringify(value);
  if (text.length <= BODY_LIMIT) {
    return text;
  }
  // Помечаем обрезку строкой-маркером — в админке видно, что тело усечено.
  return JSON.stringify({ truncated: text.slice(0, BODY_LIMIT) });
}

/** Очистка устаревших логов: 1 шанс из 200 на каждый запрос (не DoS-ит БД). */
function maybeCleanupOldLogs(retentionDays: number): void {
  if (Math.random() > 1 / 200) {
    return;
  }
  pool
    .query(`DELETE FROM public.request_logs WHERE created_at < now() - ($1 || ' days')::interval`, [
      String(retentionDays),
    ])
    .catch((err: unknown) => {
      process.stderr.write(`Очистка request_logs не удалась: ${(err as Error).message}\n`);
    });
}

export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction) {
  const basePath = req.baseUrl || ''; // при монтировании /api/v1 — '/api/v1'
  const fullPath = basePath + req.path;

  if (SKIPPED_PATHS.has(fullPath) || fullPath.startsWith('/api/v1/admin/logs')) {
    return next();
  }

  const startedAt = performance.now();

  // Перехват тела ответа: оборачиваем send/json — они обе проходят через send.
  let responseBody: unknown;
  const originalSend = res.send.bind(res);
  res.send = (body?: unknown): Response => {
    responseBody = body;
    return originalSend(body);
  };

  res.on('finish', () => {
    const durationMs = Math.round(performance.now() - startedAt);
    const status = res.statusCode;

    // Тело ответа приходит строкой либо Buffer'ом — распарсим обратно в JSON.
    let parsed: unknown = responseBody;
    if (typeof responseBody === 'string') {
      try {
        parsed = JSON.parse(responseBody);
      } catch {
        parsed = responseBody;
      }
    }
    const responsePayload = LOG_BODIES ? truncateJson(parsed) : null;

    // Текст ошибки берём из envelope { error: { message } }, который
    // формирует errorMiddleware — дублировать передачу не нужно.
    const errorPayload =
      status >= 400 && isPlainObject(parsed) && isPlainObject(parsed.error)
        ? String(parsed.error.message ?? '')
        : null;

    const requestBody = LOG_BODIES ? truncateJson(maskSensitive(req.body)) : null;
    const query = Object.keys(req.query).length > 0 ? truncateJson(maskSensitive(req.query)) : null;

    pool
      .query(
        `INSERT INTO public.request_logs
           (method, path, query, body, status, duration_ms, response_body, error,
            user_id, ip, user_agent)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7::jsonb, $8, $9, $10, $11)`,
        [
          req.method,
          fullPath,
          query,
          requestBody,
          status,
          durationMs,
          responsePayload,
          errorPayload,
          req.user?.id ?? null,
          req.ip ?? null,
          req.get('user-agent') ?? null,
        ],
      )
      .catch((err: unknown) => {
        process.stderr.write(`Запись в request_logs не удалась: ${(err as Error).message}\n`);
      });

    maybeCleanupOldLogs(RETENTION_DAYS);
  });

  next();
}
