import { pool } from '@/db/pool.js';
import { logError } from '@/shared/logger.js';
import type { NextFunction, Request, Response } from 'express';

const RETENTION_DAYS = Number(process.env.LOG_RETENTION_DAYS) || 30;

const ADMIN_PREFIX = '/api/v1/admin';

const ERROR_LIMIT = 512;

const UUID_SEGMENT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NUMERIC_SEGMENT_RE = /^\d+$/;

function normalizePath(path: string): string {
  return path
    .split('/')
    .map((segment) =>
      UUID_SEGMENT_RE.test(segment) || NUMERIC_SEGMENT_RE.test(segment) ? ':id' : segment,
    )
    .join('/');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function truncateError(message: string): string {
  return message.length > ERROR_LIMIT ? `${message.slice(0, ERROR_LIMIT)}…` : message;
}

function extractErrorMessage(body: unknown): string | null {
  const payload = typeof body === 'string' ? safeParseJson(body) : body;
  if (!isPlainObject(payload) || !isPlainObject(payload.error)) {
    return null;
  }
  const message = payload.error.message;
  if (typeof message !== 'string' || !message) {
    return null;
  }
  return truncateError(message);
}

// Настоящее сообщение внутренней ошибки кладёт errorMiddleware в res.locals.serverError,
// чтобы в request_logs попадала реальная причина, а клиенту уходил общий текст.
function extractServerError(res: Response): string | null {
  const serverError: unknown = res.locals.serverError;
  if (typeof serverError !== 'string' || !serverError) {
    return null;
  }
  return truncateError(serverError);
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function maybeCleanupOldLogs(retentionDays: number): void {
  if (Math.random() > 1 / 200) {
    return;
  }
  pool
    .query(`DELETE FROM public.request_logs WHERE created_at < now() - ($1 || ' days')::interval`, [
      String(retentionDays),
    ])
    .catch((err: unknown) => {
      logError(`Очистка request_logs не удалась: ${(err as Error).message}`);
    });
}

export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction) {
  const basePath = req.baseUrl || '';
  const fullPath = basePath + req.path;

  if (fullPath.startsWith(ADMIN_PREFIX) && req.method === 'GET') {
    return next();
  }

  const startedAt = performance.now();

  let responseBody: unknown;
  const originalSend = res.send.bind(res);
  res.send = (body?: unknown): Response => {
    responseBody = body;
    return originalSend(body);
  };

  res.on('finish', () => {
    const durationMs = Math.round(performance.now() - startedAt);
    const status = res.statusCode;
    const error =
      status >= 500
        ? (extractServerError(res) ?? extractErrorMessage(responseBody))
        : status >= 400
          ? extractErrorMessage(responseBody)
          : null;

    pool
      .query(
        `INSERT INTO public.request_logs
           (method, path, status, duration_ms, error,
            user_id, user_role, is_authenticated)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          req.method,
          normalizePath(fullPath),
          status,
          durationMs,
          error,
          req.user?.id ?? null,

          req.user?.role ?? null,

          req.user != null,
        ],
      )
      .catch((err: unknown) => {
        logError(`Запись в request_logs не удалась: ${(err as Error).message}`);
      });

    maybeCleanupOldLogs(RETENTION_DAYS);
  });

  next();
}
