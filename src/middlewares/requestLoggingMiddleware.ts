import { pool } from '@/db/pool.js';
import type { NextFunction, Request, Response } from 'express';

/**
 * Логирование HTTP-запросов в таблицу public.request_logs.
 *
 * Что пишется: метод, путь, query, статус, длительность, текст ошибки,
 * user_id + is_authenticated (автор запроса: для неавторизованных
 * user_id = null, is_authenticated = false), ip, user-agent. Тела запроса и
 * ответа НЕ сохраняются — они занимали основной объём таблицы; текст ошибки
 * извлекается на лету из envelope { error: { message } }, который отдаёт
 * errorMiddleware (ответ перехватывается обёрткой над res.send и не пишется).
 * Длительность считается до res.finish.
 *
 * Пути нормализуются: UUID- и чисто числовые сегменты заменяются на ':id'
 * (/api/v1/reports/:id) — иначе метрики топов группировали бы каждый id
 * отдельно и считали среднее время по одиночным запросам.
 *
 * Безопасность:
 *   * поля password/newPassword/refreshToken в query маскируются '***';
 *   * заголовок Authorization в базу не попадает;
 *   * query урезается до ~4 КБ;
 *   * логирование НЕ блокирует запрос: вставка fire-and-forget, ошибка
 *     записи выводится в stderr и не влияет на ответ клиенту;
 *   * не логируем health-check и всю админ-панель (/api/v1/admin/*) — иначе
 *     админка шумела бы сама от себя своими опросами;
 *
 * Настройки (.env, с дефолтами ниже):
 *   LOG_RETENTION_DAYS=30    — сколько дней хранить логи.
 */

/** Сколько дней держим строки в request_logs. */
const RETENTION_DAYS = Number(process.env.LOG_RETENTION_DAYS) || 30;

/** Максимальный размер сохраняемого query (символов JSON-строки). */
const BODY_LIMIT = 4096;

/** Точные пути, которые не логируем. */
const SKIPPED_PATHS = new Set(['/api/v1/health']);

/**
 * Префиксы, которые не логируем целиком: вся админ-панель (/api/v1/admin/*) —
 * иначе дашборд, список пользователей и просмотр логов заполняли бы
 * request_logs только своими опросами.
 */
const SKIPPED_PREFIXES = ['/api/v1/admin'];

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
  // Помечаем обрезку строкой-маркером — в админке видно, что query усечён.
  return JSON.stringify({ truncated: text.slice(0, BODY_LIMIT) });
}

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

  if (
    SKIPPED_PATHS.has(fullPath) ||
    SKIPPED_PREFIXES.some((prefix) => fullPath.startsWith(prefix))
  ) {
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

    // Тело ответа приходит строкой либо Buffer'ом — распарсим обратно в JSON.
    let parsed: unknown = responseBody;
    if (typeof responseBody === 'string') {
      try {
        parsed = JSON.parse(responseBody);
      } catch {
        parsed = responseBody;
      }
    }

    // Текст ошибки берём из envelope { error: { message } }, который
    // формирует errorMiddleware — дублировать передачу не нужно.
    const errorPayload =
      status >= 400 && isPlainObject(parsed) && isPlainObject(parsed.error)
        ? String(parsed.error.message ?? '')
        : null;

    const query = Object.keys(req.query).length > 0 ? truncateJson(maskSensitive(req.query)) : null;

    pool
      .query(
        `INSERT INTO public.request_logs
           (method, path, query, status, duration_ms, error,
            user_id, is_authenticated, ip, user_agent)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10)`,
        [
          req.method,
          normalizePath(fullPath),
          query,
          status,
          durationMs,
          errorPayload,
          req.user?.id ?? null,
          // Фиксируем факт авторизации на момент запроса: user_id может быть
          // обнулён каскадом (on delete set null) после удаления пользователя.
          req.user != null,
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
