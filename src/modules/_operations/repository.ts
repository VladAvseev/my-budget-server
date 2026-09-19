import { pool } from '@/db/pool.js';
import { toIsoString, toNumber } from '@/shared/serialize.js';
import type { PoolClient } from 'pg';
import type {
  CapitalMonthDto,
  CategorySummaryRowDto,
  CreateOperationInput,
  OperationDto,
  OperationRow,
  OperationType,
  OverviewOperationDto,
  UpdateOperationInput,
} from './types.js';

export function toOperationDto(row: OperationRow): OperationDto {
  return {
    id: row.id,
    account_id: row.account_id,
    from_account_id: row.from_account_id,
    to_account_id: row.to_account_id,
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

const OPERATION_COLUMNS = `id, user_id, type, amount, category_id,
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

  async listByMonths(
    months: string[],
    userId: string,
    types: OperationType[],
  ): Promise<OperationRow[]> {
    if (months.length === 0) {
      return [];
    }
    const { rows } = await pool.query<OperationRow>(
      `SELECT ${OPERATION_COLUMNS}
       FROM public.operations
       WHERE user_id = $1
         AND to_char(date, 'YYYY-MM') = ANY($2::text[])
         AND type = ANY($3::text[])
       ORDER BY date DESC, created_at DESC`,
      [userId, months, types],
    );
    return rows;
  }

  async listOverviewByMonths(
    months: string[],
    userId: string,
  ): Promise<OverviewOperationDto[]> {
    if (months.length === 0) {
      return [];
    }
    const { rows } = await pool.query<{
      month: string;
      type: OperationType;
      amount: string;
      category_id: string | null;
    }>(
      `SELECT to_char(date, 'YYYY-MM') AS month, type, amount, category_id
       FROM public.operations
       WHERE to_char(date, 'YYYY-MM') = ANY($1::text[]) AND user_id = $2`,
      [months, userId],
    );
    return rows.map((row) => ({
      month: row.month,
      type: row.type,
      amount: toNumber(row.amount),
      category_id: row.category_id,
    }));
  }

  async categorySummary(
    months: string[],
    userId: string,
  ): Promise<CategorySummaryRowDto[]> {
    if (months.length === 0) {
      return [];
    }
    const { rows } = await pool.query<{
      month: string;
      type: OperationType;
      amount: string;
      category_id: string | null;
    }>(
      `SELECT to_char(date, 'YYYY-MM') AS month, type, category_id,
              coalesce(sum(amount::numeric), 0) AS amount
         FROM public.operations
        WHERE to_char(date, 'YYYY-MM') = ANY($1::text[]) AND user_id = $2
          AND type IN ('income', 'expense')
        GROUP BY month, type, category_id`,
      [months, userId],
    );
    return rows.map((row) => ({
      month: row.month,
      type: row.type,
      amount: toNumber(row.amount),
      category_id: row.category_id,
    }));
  }

  async listMonths(userId: string): Promise<string[]> {
    const { rows } = await pool.query<{ month: string }>(
      `SELECT to_char(date, 'YYYY-MM') AS month
         FROM public.operations
        WHERE user_id = $1 AND date IS NOT NULL
        GROUP BY month
        HAVING count(*) > 0
        ORDER BY month DESC`,
      [userId],
    );
    return rows.map((row) => row.month);
  }

  async monthSummary(
    userId: string,
    from: string,
    to: string,
  ): Promise<{ income: number; expense: number }> {
    const { rows } = await pool.query<{ income: string; expense: string }>(
      `SELECT
         coalesce(sum(amount::numeric) FILTER (WHERE type = 'income'), 0) AS income,
         coalesce(sum(amount::numeric) FILTER (WHERE type = 'expense'), 0) AS expense
       FROM public.operations
       WHERE user_id = $1 AND date >= $2::date AND date <= $3::date`,
      [userId, from, to],
    );
    const row = rows[0];
    return { income: Number(row?.income ?? 0), expense: Number(row?.expense ?? 0) };
  }

  async listCapitalDynamics(userId: string): Promise<CapitalMonthDto[]> {
    const { rows } = await pool.query<{ month: string; delta: string }>(
      `SELECT to_char(date_trunc('month', date), 'YYYY-MM') AS month,
              coalesce(sum(amount::numeric) FILTER (WHERE type = 'income'), 0)
                - coalesce(sum(amount::numeric) FILTER (WHERE type = 'expense'), 0) AS delta
         FROM public.operations
        WHERE user_id = $1 AND date IS NOT NULL AND date <= CURRENT_DATE
        GROUP BY date_trunc('month', date)
        ORDER BY date_trunc('month', date)`,
      [userId],
    );
    return rows.map((row) => ({ month: row.month, delta: Number(row.delta) }));
  }

  async getOwnedAccounts(client: PoolClient, userId: string, ids: string[]) {
    const { rows } = await client.query<{ id: string; is_closed: boolean }>(
      `SELECT id, is_closed FROM public.accounts
       WHERE user_id = $1 AND id = ANY($2::uuid[])`,
      [userId, ids],
    );
    return rows;
  }

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

  async create(
    input: CreateOperationInput,
    userId: string,
    client: PoolClient,
  ): Promise<OperationRow> {
    const { rows } = await client.query<OperationRow>(
      `INSERT INTO public.operations
         (user_id, type, amount, category_id, description, date,
          account_id, from_account_id, to_account_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${OPERATION_COLUMNS}`,
      [
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

  async remove(id: string, userId: string, client: PoolClient): Promise<boolean> {
    const { rowCount } = await client.query(
      'DELETE FROM public.operations WHERE id = $1 AND user_id = $2',
      [id, userId],
    );
    return (rowCount ?? 0) > 0;
  }
}

export const operationsRepository = new OperationsRepository();
