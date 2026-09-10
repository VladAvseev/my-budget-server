/**
 * Типы модуля reports: строки БД (snake_case) и DTO ответов.
 *
 * Ключи ответов — snake_case, как их исторически получал клиент
 * (см. client/src/modules/_reports/**), чтобы не переписывать хуки и UI.
 */

/** Строка таблицы `reports` как её отдаёт pg (см. db/schema.sql). */
export interface ReportRow {
  id: string;
  user_id: string;
  name: string;
  /** Код периода ('' — не задан); уникален в рамках пользователя (частичный индекс). */
  code: string;
  has_daily_expenses: boolean;
  /** numeric → строка pg; null, когда daily-режим выключен. */
  daily_budget: string | null;
  /** 'YYYY-MM-DD' | null (парсер DATE отключён в pool.ts). */
  period_start: string | null;
  period_end: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Ответ API с отчётом. */
export interface ReportDto {
  id: string;
  user_id: string;
  name: string;
  code: string;
  has_daily_expenses: boolean;
  daily_budget: number | null;
  period_start: string | null;
  period_end: string | null;
  created_at: string;
  updated_at: string;
}

/** Строка `category_limits` (лимит расхода по категории внутри отчёта). */
export interface CategoryLimitRow {
  id: string;
  report_id: string;
  category_id: string;
  user_id: string;
  amount: string;
  created_at: Date;
  updated_at: Date;
}

/** Ответ API с лимитом категории. */
export interface CategoryLimitDto {
  id: string;
  report_id: string;
  category_id: string;
  user_id: string;
  amount: number;
  created_at: string;
  updated_at: string;
}

/** Элемент тела PUT /reports/:id/category-limits. */
export interface CategoryLimitItem {
  categoryId: string;
  amount: number;
}

/** Ответ GET /reports/:id/summary. */
export interface ReportSummary {
  income: number;
  expense: number;
  /** savings минус savings_out — «накоплено с учётом снятий». */
  savings: number;
  daily: number;
}

/** Разобранные и проверенные данные POST /reports. */
export interface CreateReportInput {
  name: string;
  code: string;
  hasDailyExpenses: boolean;
  dailyBudget: number | null;
  periodStart: string | null;
  periodEnd: string | null;
}
