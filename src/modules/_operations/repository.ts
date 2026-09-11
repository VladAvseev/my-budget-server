import { pool } from '@/db/pool.js';
import { toIsoString, toNumber } from '@/shared/serialize.js';
import type { PoolClient } from 'pg';
import type {
  CreateOperationInput,
  OperationDto,
  OperationRow,
  OperationType,
  OverviewOperationDto,
  SavingsOperationDto,
  SavingsOperationRow,
  UpdateOperationInput,
} from './types.js';

/**
 * Слой доступа к данным операций.
 *
 * Операция принадлежит отчёту, а отчёт — пользователю: перед каждой
 * операцией с отчётом вызывается assertReportOwnership(), а сами запросы
 * к операциям фильтруются по operations.user_id (он проставляется из токена).
 */

/** Строка БД → DTO ответа. */
export function toOperationDto(row: OperationRow): OperationDto {
  return {
    id: row.id,
    report_id: row.report_id,
    user_id: row.user_id,
    type: row.type,
    amount: toNumber(row.amount),
    category_id: row.category_id,
    description: row.description,
    date: row.date,
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
  };
}

/** Полный набор колонок для RETURNING — совпадает с OperationRow. */
const OPERATION_COLUMNS = `id, report_id, user_id, type, amount, category_id,
       description, date, created_at, updated_at`;

export class OperationsRepository {
  /** 1 — отчёт существует и принадлежит пользователю; иначе бросаем в сервисе 404. */
  async isReportOwned(reportId: string, userId: string, client?: PoolClient): Promise<boolean> {
    const runner = client ?? pool;
    const { rows } = await runner.query(
      'SELECT 1 FROM public.reports WHERE id = $1 AND user_id = $2',
      [reportId, userId],
    );
    return rows.length > 0;
  }

  /**
   * Операции одного отчёта по одному или нескольким типам. Порядок: для
   * одиночного daily — по дате расхода (nulls last), для остальных —
   * по времени создания; оба desc.
   */
  async listByReport(reportId: string, types: OperationType[]): Promise<OperationRow[]> {
    const dailyOnly = types.length === 1 && types[0] === 'daily';
    const { rows } = await pool.query<OperationRow>(
      `SELECT ${OPERATION_COLUMNS}
       FROM public.operations
       WHERE report_id = $1 AND type = ANY($2::text[])
       ORDER BY
         (CASE WHEN $3 THEN date ELSE NULL END) DESC NULLS LAST,
         created_at DESC`,
      [reportId, types, dailyOnly],
    );
    return rows;
  }

  /**
   * Операции по списку отчётов, только поля сводки. Фильтр по user_id
   * не даёт вытащить чужие отчёты — они молча выпадают из выборки.
   */
  async listByReports(reportIds: string[], userId: string): Promise<OverviewOperationDto[]> {
    if (reportIds.length === 0) {
      return [];
    }
    // amount — numeric, т.е. строка pg; приводим к числу на маппинге ниже.
    const { rows } = await pool.query<{
      report_id: string;
      type: OperationType;
      amount: string;
      category_id: string | null;
    }>(
      `SELECT report_id, type, amount, category_id
       FROM public.operations
       WHERE report_id = ANY($1::uuid[]) AND user_id = $2`,
      [reportIds, userId],
    );
    return rows.map((row) => ({
      report_id: row.report_id,
      type: row.type,
      amount: toNumber(row.amount),
      category_id: row.category_id,
    }));
  }

  /**
   * Пополнения/снятия накоплений с данными отчёта. Порядок:
   * сначала по периоду отчёта, затем по created_at.
   */
  async listSavings(userId: string): Promise<SavingsOperationRow[]> {
    const { rows } = await pool.query<SavingsOperationRow>(
      `SELECT o.id, o.report_id, o.user_id, o.type, o.amount, o.category_id,
              o.description, o.date, o.created_at, o.updated_at,
              r.name AS report_name, r.period_start AS report_period_start
       FROM public.operations o
       JOIN public.reports r ON r.id = o.report_id
       WHERE o.user_id = $1 AND o.type IN ('savings', 'savings_out')
       ORDER BY r.period_start DESC, o.created_at DESC`,
      [userId],
    );
    return rows;
  }

  /** Создание операции: user_id берётся из проверенного токена. */
  async create(input: CreateOperationInput, userId: string): Promise<OperationRow> {
    const { rows } = await pool.query<OperationRow>(
      `INSERT INTO public.operations
         (report_id, user_id, type, amount, category_id, description, date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${OPERATION_COLUMNS}`,
      [
        input.reportId,
        userId,
        input.type,
        input.amount,
        input.categoryId,
        input.description,
        input.date,
      ],
    );
    return rows[0];
  }

  /**
   * Обновление только переданных полей (см. комментарий к UpdateOperationInput).
   * WHERE id AND user_id: чужую операцию не задеть.
   */
  async update(
    id: string,
    userId: string,
    input: UpdateOperationInput,
  ): Promise<OperationRow | null> {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (input.amount !== undefined) {
      values.push(input.amount);
      sets.push(`amount = $${values.length}`);
    }
    if (input.categoryId !== undefined) {
      values.push(input.categoryId);
      sets.push(`category_id = $${values.length}`);
    }
    if (input.description !== undefined) {
      values.push(input.description);
      sets.push(`description = $${values.length}`);
    }
    if (input.type !== undefined) {
      values.push(input.type);
      sets.push(`type = $${values.length}`);
    }
    if (input.date !== undefined) {
      values.push(input.date);
      sets.push(`date = $${values.length}`);
    }

    if (sets.length === 0) {
      const { rows } = await pool.query<OperationRow>(
        `SELECT ${OPERATION_COLUMNS} FROM public.operations
         WHERE id = $1 AND user_id = $2`,
        [id, userId],
      );
      return rows[0] ?? null;
    }

    sets.push('updated_at = now()');
    values.push(id, userId);

    const { rows } = await pool.query<OperationRow>(
      `UPDATE public.operations
       SET ${sets.join(', ')}
       WHERE id = $${values.length - 1} AND user_id = $${values.length}
       RETURNING ${OPERATION_COLUMNS}`,
      values,
    );
    return rows[0] ?? null;
  }

  /** Удаление операции с ownership-фильтром. */
  async remove(id: string, userId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      'DELETE FROM public.operations WHERE id = $1 AND user_id = $2',
      [id, userId],
    );
    return (rowCount ?? 0) > 0;
  }

  /** DTO строки «пополнение/снятие» с полями отчёта. */
  toSavingsDto(row: SavingsOperationRow): SavingsOperationDto {
    return {
      ...toOperationDto(row),
      // Ключи reportName/reportPeriodStart исторические, не переименовываем.
      reportName: row.report_name,
      reportPeriodStart: row.report_period_start,
    };
  }
}

export const operationsRepository = new OperationsRepository();
