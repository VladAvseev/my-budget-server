import { pool } from '@/db/pool.js';
import type { NextFunction, Request, Response } from 'express';

/**
 * Логирование HTTP-запросов в таблицу public.request_logs.
 *
 * Что пишется на каждый запрос: дата и время (created_at), метод, путь, статус,
 * длительность, user_id + user_role + is_authenticated (автор запроса: роль из
 * JWT-claim на момент запроса — для неавторизованных user_id и user_role = null,
 * is_authenticated = false) и ip. Дополнительно для ответов с ошибкой (статус
 * >= 400) сохраняется текст ошибки — админка показывает его при раскрытии строки.
 * user_role позволяет фильтровать логи/графики по роли автора (пользователи без
 * админов) и ретроспективно: роль не тянется из users, где она может измениться.
 *
 * Что НЕ пишется: параметры запроса (query), тела запроса и ответа, User-Agent.
 * Тела и query занимали основной объём таблицы и светили данные в БД, а
 * User-Agent нигде не отображался (атрибутика устройств есть у refresh-токенов).
 * Длительность считается до res.finish.
 *
 * Пути нормализуются: UUID- и чисто числовые сегменты заменяются на ':id'
 * (/api/v1/reports/:id) — иначе метрики топов группировали бы каждый id
 * отдельно и считали среднее время по одиночным запросам.
 *
 * Логирование НЕ блокирует запрос: вставка fire-and-forget, ошибка записи
 * выводится в stderr и не влияет на ответ клиенту.
 *
 * Не логируем GET'ы админ-панели (/api/v1/admin/*) — иначе дашборд, список
 * пользователей и просмотр логов заполняли бы request_logs сами себя.
 * Не-GET админ-запросы (например, DELETE /admin/users/:id) пишем как audit
 * trail: destructive-действия админа должны оставлять след (user_id, роль, ip).
 *
 * Настройки (.env, с дефолтами ниже):
 *   LOG_RETENTION_DAYS=30    — сколько дней хранить логи.
 */

/** Сколько дней держим строки в request_logs. */
const RETENTION_DAYS = Number(process.env.LOG_RETENTION_DAYS) || 30;

/** Префикс админ-панели: её GET'ы не логируем (см. шапку), мутации — логируем. */
const ADMIN_PREFIX = '/api/v1/admin';

/** Максимальная длина сохраняемого текста ошибки (страховка от простыней). */
const ERROR_LIMIT = 512;

/** Сегмент пути — UUID (id ресурсов в БД). */
const UUID_SEGMENT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Сегмент пути — числовой id (на случай bigint-маршрутов в будущем). */
const NUMERIC_SEGMENT_RE = /^\d+$/;

/**
 * Нормализация пути для хранения: UUID- и числовые сегменты -> ':id',
 * чтобы все запросы к одному маршруту (/reports/123 -> /reports/:id)
 * группировались в метриках топов корректно.
 */
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

/**
 * Текст ошибки из envelope `{ error: { message } }`, который отдаёт
 * errorMiddleware. Тело ответа в базу не пишем — извлекаем на лету только
 * сообщение, обрезая его до ERROR_LIMIT.
 */
function extractErrorMessage(body: unknown): string | null {
  const payload = typeof body === 'string' ? safeParseJson(body) : body;
  if (!isPlainObject(payload) || !isPlainObject(payload.error)) {
    return null;
  }
  const message = payload.error.message;
  if (typeof message !== 'string' || !message) {
    return null;
  }
  return message.length > ERROR_LIMIT ? `${message.slice(0, ERROR_LIMIT)}…` : message;
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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

  // Опросы админки (GET) не пишем, её мутации — пишем (audit trail).
  if (fullPath.startsWith(ADMIN_PREFIX) && req.method === 'GET') {
    return next();
  }

  const startedAt = performance.now();

  // Перехватываем ответ только ради текста ошибки: тело ответа в базу не пишем.
  let responseBody: unknown;
  const originalSend = res.send.bind(res);
  res.send = (body?: unknown): Response => {
    responseBody = body;
    return originalSend(body);
  };

  res.on('finish', () => {
    const durationMs = Math.round(performance.now() - startedAt);
    const status = res.statusCode;
    const error = status >= 400 ? extractErrorMessage(responseBody) : null;

    pool
      .query(
        `INSERT INTO public.request_logs
           (method, path, status, duration_ms, error,
            user_id, user_role, is_authenticated, ip)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          req.method,
          normalizePath(fullPath),
          status,
          durationMs,
          error,
          req.user?.id ?? null,
          // Роль автора из JWT-claim на момент запроса: фиксация именно та,
          // что была у пользователя при обращении (в users она может смениться).
          req.user?.role ?? null,
          // Фиксируем факт авторизации на момент запроса: user_id может быть
          // обнулён каскадом (on delete set null) после удаления пользователя.
          req.user != null,
          req.ip ?? null,
        ],
      )
      .catch((err: unknown) => {
        process.stderr.write(`Запись в request_logs не удалась: ${(err as Error).message}\n`);
      });

    maybeCleanupOldLogs(RETENTION_DAYS);
  });

  next();
}
