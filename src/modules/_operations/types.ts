/**
 * Типы модуля operations.
 *
 * Ответы — snake_case + camelCase-дополнения вроде reportName: ключи
 * совпадают с доменным типом Operation из клиента
 * (см. client/src/shared/api/types/domain.ts), а SavingsOperationDto —
 * с клиентским SavingsOperation
 * (см. client/src/shared/api/hooks/useSavingsOperations.ts).
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

/** Ответ API с операцией. */
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
 * Пополнения/снятия накоплений: та же операция + поля отчёта (reportName,
 * reportPeriodStart) — camelCase-ключи исторические,
 * на них завязан клиентский AccumulationsCard.
 */
export interface SavingsOperationDto extends OperationDto {
  reportName: string;
  reportPeriodStart: string | null;
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

/** Доп. поля строки-операции из JOIN с reports. */
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
 * Обновляются только переданные поля (REST-семантика PATCH):
 * случайный null из запроса не стирает данные.
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
