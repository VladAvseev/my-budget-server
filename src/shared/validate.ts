import { AppError } from '@/shared/appError.js';

/**
 * Общие валидаторы входных данных HTTP-запросов.
 *
 * Заимствованы у модуля _auth (там проверки написаны напрямую в сервисе):
 * каждый непроверенный вход превращаем в AppError(400) с русским текстом —
 * клиент покажет его в тосте вместо «Что-то пошло не так».
 * Отдельной библиотеки валидации (zod/joi) в шаблон не добавляли — проверки
 * простые и их немного, ручной разбор остаётся читаемым.
 */

/** Формат uuid канонический (8-4-4-4-12), регистр не важен. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Только даты вида 'YYYY-MM-DD' — их принимает PostgreSQL в колонку `date`. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** id из URL-параметра: не-uuid не доходит до SQL (иначе pg упал бы с 500 на 22P02). */
export function requireUuid(value: unknown, message = 'Некорректный идентификатор'): string {
  if (!isUuid(value)) {
    throw new AppError(message, 400);
  }
  return value;
}

/** Обязательная непустая строка (после trim) — name/description из форм клиента. */
export function requireNonEmptyString(
  value: unknown,
  message = 'Поле обязательно для заполнения',
): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(message, 400);
  }
  return value.trim();
}

/** Строка или null (nullable-колонки color/category_id-подобные текстовые поля). */
export function optionalStringOrNull(value: unknown, message: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new AppError(message, 400);
  }
  return value.trim() === '' ? null : value.trim();
}

/**
 * Число-сумма. strictPositive=true — суммы операций/целей (должны быть > 0,
 * как check (amount > 0) на goals в db/schema.sql); false — накопления,
 * где допустим 0 (default 0 в схеме).
 */
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

/** Дата 'YYYY-MM-DD' или null (date/category-limits/targetDate/периоды отчёта). */
export function optionalDateOrNull(value: unknown, message: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    throw new AppError(message, 400);
  }
  return value;
}

/** Проверка значения из перечисления (type операции/категории). */
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

/** Булев флаг из JSON (hasDailyExpenses/onboarded-подобные поля). */
export function requireBoolean(value: unknown, message: string): boolean {
  if (typeof value !== 'boolean') {
    throw new AppError(message, 400);
  }
  return value;
}
