/**
 * Мелкие конвертеры значений из строк PostgreSQL в JSON-ответы API.
 *
 * Форматы подобраны так, чтобы ответы совпадали с jsonb, который клиент
 * получал от RPC-функций Supabase (см. зеркалирование ключей в types модулей):
 *   * numeric в драйвере pg всегда приходит СТРОКОЙ ("1500.50") — приводим
 *     к Number, как это делал jsonb_build_object;
 *   * колонки `date` (1082) оставляем строкой 'YYYY-MM-DD' — парсер отключён
 *     в src/db/pool.js (иначе pg делает Date на локальную полночь и ISO-строка
 *     уезжает на день назад);
 *   * `timestamptz` — настоящий Date, сериализуем через toISOString().
 */

/** numeric-строка → число; null сохраняется (напр. daily_budget у отчёта без daily-режима). */
export function toNumberOrNull(value: string | null): number | null {
  return value === null ? null : Number(value);
}

/** numeric-строка → число (для колонок NOT NULL). */
export function toNumber(value: string): number {
  return Number(value);
}

/** timestamptz → ISO-строка ('2025-01-01T12:00:00.000Z'), как в jsonb у Supabase. */
export function toIsoString(value: Date): string {
  return value.toISOString();
}
