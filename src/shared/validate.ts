import { AppError } from '@/shared/appError.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function requireUuid(value: unknown, message = 'Некорректный идентификатор'): string {
  if (!isUuid(value)) {
    throw new AppError(message, 400);
  }
  return value;
}

export function requireNonEmptyString(
  value: unknown,
  message = 'Поле обязательно для заполнения',
): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(message, 400);
  }
  return value.trim();
}

export function optionalStringOrNull(value: unknown, message: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new AppError(message, 400);
  }
  return value.trim() === '' ? null : value.trim();
}

export function requireAmount(
  value: unknown,
  message = 'Сумма должна быть положительным числом',
  strictPositive = true,
): number {
  const num = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  if (!Number.isFinite(num) || (strictPositive ? num <= 0 : num < 0)) {
    throw new AppError(message, 400);
  }
  return num;
}

export function optionalDateOrNull(value: unknown, message: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    throw new AppError(message, 400);
  }
  return value;
}

export function requireDate(value: unknown, message: string): string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    throw new AppError(message, 400);
  }
  return value;
}

export function parseMonthsParam(value: unknown, message: string): string[] {
  if (typeof value !== 'string' || value.trim() === '') {
    return [];
  }
  const months = [...new Set(
    value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== ''),
  )];
  if (months.length > 120) {
    throw new AppError(message, 400);
  }
  for (const month of months) {
    if (!MONTH_RE.test(month)) {
      throw new AppError(message, 400);
    }
  }
  return months.sort();
}

export function requireEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  message: string,
): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new AppError(message, 400);
  }
  return value as T;
}

export function requireBoolean(value: unknown, message: string): boolean {
  if (typeof value !== 'boolean') {
    throw new AppError(message, 400);
  }
  return value;
}
