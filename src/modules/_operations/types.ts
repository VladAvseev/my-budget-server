/**
 * Типы модуля operations.
 *
 * Порт RPC Supabase: get_operations_by_report / get_operations_by_reports /
 * get_savings_operations / create_operation / update_operation /
 * delete_operation (см. client/src/modules/_reports/_report/api/*.sql и
 * client/src/modules/_accumulations/api/useSavingsOperations.sql).
 * Ответы зеркалят jsonb этих функций (snake_case + camelCase-дополнения
 * вроде reportName), ключи совпадают с доменным типом Operation из клиента.
 */

/** Типы операций — CHECK-констрейнт `operations_type_check` в db/schema.sql. */
export type OperationType = 'income' | 'expense' | 'savings' | 'savings_out' | 'daily';

/** Строка таблицы `operations` как её отдаёт pg (см. db/schema.sql). */
export interface OperationRow {
  id: string;
  report_id: string;
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

/** Ответ API — копия jsonb_build_object из get_operations_by_report. */
export interface OperationDto {
  id: string;
  report_id: string;
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
 * Ответ get_savings_operations: та же операция + поля отчёта (reportName,
 * reportPeriodStart) — camelCase-ключи сохранены как в историческом RPC,
 * на них завязан клиентский AccumulationsCard.
 */
export interface SavingsOperationDto extends OperationDto {
  reportName: string;
  reportPeriodStart: string | null;
}

/**
 * Ответ get_operations_by_reports — только поля для сводки overview
 * (в RPC id даже не возвращался).
 */
export interface OverviewOperationDto {
  report_id: string;
  type: OperationType;
  amount: number;
  category_id: string | null;
}

/** Доп. поля строки-операции из JOIN с reports (get_savings_operations). */
export interface SavingsOperationRow extends OperationRow {
  report_name: string;
  report_period_start: string | null;
}

/** POST /operations — клиентский OperationInput + reportId. */
export interface CreateOperationInput {
  reportId: string;
  type: OperationType;
  amount: number;
  categoryId: string | null;
  description: string | null;
  date: string | null;
}

/**
 * PATCH /operations/:id — клиентский OperationUpdateInput.
 * В отличие от RPC (где amount/category_id/description затирались всегда,
 * а type/date шли через coalesce), здесь обновляем только переданные поля:
 * REST-семантика PATCH, случайный null из запроса больше не стирает данные.
 */
export interface UpdateOperationInput {
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
  'savings',
  'savings_out',
  'daily',
] as const satisfies readonly OperationType[];
