import { pool } from '@/db/pool.js';
import { toIsoString, toNumber } from '@/shared/serialize.js';
import type { PoolClient } from 'pg';
import type {
  CategorySummaryRowDto,
  CreateOperationInput,
  OperationDto,
  OperationRow,
  OperationType,
  OverviewOperationDto,
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
    account_id: row.account_id,
    from_account_id: row.from_account_id,
    to_account_id: row.to_account_id,
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
       account_id, from_account_id, to_account_id,
       description, date, created_at, updated_at`;

export class OperationsRepository {
  async getById(id: string, userId: string, client: PoolClient): Promise<OperationRow | null> {
    const { rows } = await client.query<OperationRow>(
      `SELECT ${OPERATION_COLUMNS} FROM public.operations WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    return rows[0] ?? null;
  }

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
   * Сводка по набору отчётов: суммы, свёрнутые сервером по report_id, type и
   * category_id. Фильтр по user_id не даёт вытащить чужие отчёты — они молча
   * выпадают из выборки.
   */
  async categorySummary(reportIds: string[], userId: string): Promise<CategorySummaryRowDto[]> {
    if (reportIds.length === 0) {
      return [];
    }
    const { rows } = await pool.query<{
      report_id: string;
      type: OperationType;
      amount: string;
      category_id: string | null;
    }>(
      `SELECT report_id, type, category_id,
              coalesce(sum(amount::numeric), 0) AS amount
         FROM public.operations
        WHERE report_id = ANY($1::uuid[]) AND user_id = $2
          AND type IN ('income', 'expense', 'daily')
        GROUP BY report_id, type, category_id`,
      [reportIds, userId],
    );
    return rows.map((row) => ({
      report_id: row.report_id,
      type: row.type,
      amount: toNumber(row.amount),
      category_id: row.category_id,
    }));
  }

  /** Счета только текущего пользователя; вызывается внутри транзакции записи. */
  async getOwnedAccounts(client: PoolClient, userId: string, ids: string[]) {
    const { rows } = await client.query<{ id: string; is_closed: boolean }>(
      `SELECT id, is_closed FROM public.accounts
       WHERE user_id = $1 AND id = ANY($2::uuid[])`,
      [userId, ids],
    );
    return rows;
  }

  /** Для операций допустимы только свои категории доходов и расходов. */
  async isCategoryAllowed(
    client: PoolClient,
    userId: string,
    categoryId: string,
  ): Promise<boolean> {
    const { rows } = await client.query(
      `SELECT 1 FROM public.categories
       WHERE user_id = $1 AND id = $2 AND type IN ('income', 'expense')`,
      [userId, categoryId],
    );
    return rows.length > 0;
  }

  /** Создание операции: user_id берётся из проверенного токена. */
  async create(
    input: CreateOperationInput,
    userId: string,
    client: PoolClient,
  ): Promise<OperationRow> {
    const { rows } = await client.query<OperationRow>(
      `INSERT INTO public.operations
         (report_id, user_id, type, amount, category_id, description, date,
          account_id, from_account_id, to_account_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${OPERATION_COLUMNS}`,
      [
        input.reportId,
        userId,
        input.type,
        input.amount,
        input.categoryId,
        input.description,
        input.date,
        input.account_id,
        input.from_account_id,
        input.to_account_id,
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
    client: PoolClient,
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

    for (const field of ['account_id', 'from_account_id', 'to_account_id'] as const) {
      if (input[field] !== undefined) {
        values.push(input[field]);
        sets.push(`${field} = $${values.length}`);
      }
    }

    if (sets.length === 0) {
      const { rows } = await client.query<OperationRow>(
        `SELECT ${OPERATION_COLUMNS} FROM public.operations
         WHERE id = $1 AND user_id = $2`,
        [id, userId],
      );
      return rows[0] ?? null;
    }

    sets.push('updated_at = now()');
    values.push(id, userId);

    const { rows } = await client.query<OperationRow>(
      `UPDATE public.operations
       SET ${sets.join(', ')}
       WHERE id = $${values.length - 1} AND user_id = $${values.length}
       RETURNING ${OPERATION_COLUMNS}`,
      values,
    );
    return rows[0] ?? null;
  }

  /** Удаление операции с ownership-фильтром. */
  async remove(id: string, userId: string, client: PoolClient): Promise<boolean> {
    const { rowCount } = await client.query(
      'DELETE FROM public.operations WHERE id = $1 AND user_id = $2',
      [id, userId],
    );
    return (rowCount ?? 0) > 0;
  }
}

export const operationsRepository = new OperationsRepository();
