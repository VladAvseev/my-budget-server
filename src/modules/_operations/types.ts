/** Типы операций и DTO ответов API (snake_case). */

/** Типы операций — CHECK-констрейнт `operations_type_check` в db/schema.sql. */
export type OperationType = 'income' | 'expense' | 'daily' | 'transfer';

/** Строка таблицы `operations` как её отдаёт pg (см. db/schema.sql). */
export interface OperationRow {
  account_id: string | null;
  from_account_id: string | null;
  to_account_id: string | null;
  id: string;
  report_id: string | null;
  user_id: string;
  type: OperationType;
  /** numeric → строка драйвера pg, в DTO конвертим в число. */
  amount: string;
  category_id: string | null;
  description: string | null;
  /** 'YYYY-MM-DD' или null (парсер DATE отключён в pool.ts). */
  date: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Ответ API с операцией. */
export interface OperationDto {
  account_id: string | null;
  from_account_id: string | null;
  to_account_id: string | null;
  id: string;
  report_id: string | null;
  user_id: string;
  type: OperationType;
  amount: number;
  category_id: string | null;
  description: string | null;
  date: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Ответ для сводки overview — только нужные поля, id операции не возвращается.
 */
export interface OverviewOperationDto {
  report_id: string;
  type: OperationType;
  amount: number;
  category_id: string | null;
}

/**
 * Ответ GET /operations/category-summary: суммы операций, свёрнутые сервером
 * по отчёту, типу и категории.
 */
export interface CategorySummaryRowDto {
  report_id: string;
  type: OperationType;
  amount: number;
  category_id: string | null;
}

/** Нормализованная привязка: одно поле для обычной операции, два для перевода. */
export interface OperationAccounts {
  account_id: string | null;
  from_account_id: string | null;
  to_account_id: string | null;
}

/** POST /operations — клиентский OperationInput + reportId. */
export interface CreateOperationInput extends OperationAccounts {
  reportId: string;
  type: OperationType;
  amount: number;
  categoryId: string | null;
  description: string | null;
  date: string | null;
}

/**
 * PATCH /operations/:id — клиентский OperationUpdateInput.
 * Обновляются только переданные поля (REST-семантика PATCH):
 * отсутствующие поля сохраняют текущие значения.
 */
export interface UpdateOperationInput extends Partial<OperationAccounts> {
  amount?: number;
  categoryId?: string | null;
  description?: string | null;
  type?: OperationType;
  date?: string | null;
}

/** Перечисление type операций — CHECK-констрейнт в db/schema.sql. */
export const OPERATION_TYPES = [
  'income',
  'expense',
  'transfer',
  'daily',
] as const satisfies readonly OperationType[];
