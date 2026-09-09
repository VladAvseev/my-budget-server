/**
 * Типы модуля reports.
 *
 * Порт RPC Supabase: get_reports / create_report / get_report /
 * update_report / delete_report / get_report_summary / get_category_limits /
 * set_category_limits / create_daily_expense / disable_daily_expenses
 * (см. client/src/modules/_reports/**).
 * Ответы зеркалят jsonb RPC (snake_case-ключи) ради дешёвой миграции клиента.
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

/** Ответ API — копия jsonb_build_object из get_reports/get_report/create_report. */
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

/** Ответ API — копия jsonb_build_object из get_category_limits/set_category_limits. */
export interface CategoryLimitDto {
  id: string;
  report_id: string;
  category_id: string;
  user_id: string;
  amount: number;
  created_at: string;
  updated_at: string;
}

/** Элемент тела PUT /reports/:id/category-limits (= p_limits в RPC). */
export interface CategoryLimitItem {
  categoryId: string;
  amount: number;
}

/** Ответ GET /reports/:id/summary — копия jsonb из get_report_summary. */
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
