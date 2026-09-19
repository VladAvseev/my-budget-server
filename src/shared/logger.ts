import type { Request } from 'express';

// Текст, который отдаётся клиенту при любой внутренней (5xx) ошибке.
// Настоящая причина пишется в stderr и в request_logs.error, наружу не уходит.
export const INTERNAL_SERVER_ERROR_MESSAGE = 'Внутренняя ошибка сервера';

interface PgDetails {
  code?: unknown;
  detail?: unknown;
  constraint?: unknown;
  table?: unknown;
}

// Извлекает настоящее сообщение из любой ошибки для логов.
// Никогда не используется как ответ клиенту при 5xx.
export function getRealErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  if (typeof err === 'string' && err) {
    return err;
  }
  try {
    const text = JSON.stringify(err);
    if (text && text !== '{}') {
      return text;
    }
  } catch {
    // игнорируем — ниже вернём заглушку
  }
  return 'Неизвестная ошибка';
}

function formatPgDetails(err: unknown): string {
  if (typeof err !== 'object' || err === null) {
    return '';
  }
  const details = err as PgDetails;
  const parts: string[] = [];
  if (typeof details.code === 'string' && details.code) {
    parts.push(`pg_code=${details.code}`);
  }
  if (typeof details.detail === 'string' && details.detail) {
    parts.push(`pg_detail=${details.detail}`);
  }
  if (typeof details.constraint === 'string' && details.constraint) {
    parts.push(`constraint=${details.constraint}`);
  }
  if (typeof details.table === 'string' && details.table) {
    parts.push(`table=${details.table}`);
  }
  return parts.length > 0 ? ` (${parts.join(' ')})` : '';
}

// Пишет внутреннюю ошибку в stderr: метод, путь, автор, настоящее сообщение и стек.
// Клиенту при этом уходит только INTERNAL_SERVER_ERROR_MESSAGE (см. errorMiddleware).
export function logServerError(req: Request, err: unknown): void {
  const message = getRealErrorMessage(err);
  const user = req.user ? ` user=${req.user.id} role=${req.user.role}` : '';
  const stack = err instanceof Error && err.stack ? `\n${err.stack}` : '';
  // eslint-disable-next-line no-console -- единственное место прямого вывода 5xx в stderr
  console.error(
    `${req.method} ${req.originalUrl} -> 500${user}: ${message}${formatPgDetails(err)}${stack}`,
  );
}

// Операционные предупреждения (компрометация сессии, целостность документов и т.п.).
export function logWarn(message: string): void {
  // eslint-disable-next-line no-console -- централизованный warn, остальной код идёт через него
  console.warn(message);
}

// Ошибки инфраструктуры самого логирования (запись/чистка request_logs).
export function logError(message: string): void {
  // eslint-disable-next-line no-console -- централизованный error, остальной код идёт через него
  console.error(message);
}
