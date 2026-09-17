import type { PoolClient } from 'pg';
import { pool } from '@/db/pool.js';
import { toIsoString, toNumber } from '@/shared/serialize.js';
import type { GoalDto, GoalRow, UpdateGoalInput } from './types.js';

const GOAL_COLUMNS = `id, user_id, account_id, amount, target_date, created_at, updated_at`;

export function toGoalDto(row: GoalRow): GoalDto {
  return {
    id: row.id,
    user_id: row.user_id,
    account_id: row.account_id,
    amount: toNumber(row.amount),
    target_date: row.target_date,
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
  };
}

export class GoalsRepository {

  async list(userId: string): Promise<GoalRow[]> {
    const { rows } = await pool.query<GoalRow>(
      `SELECT ${GOAL_COLUMNS} FROM public.goals
       WHERE user_id = $1 AND EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = goals.account_id AND a.user_id = $1 AND NOT a.is_closed)
       ORDER BY created_at DESC`,
      [userId],
    );
    return rows;
  }

  async create(
    client: PoolClient,
    userId: string,
    input: { accountId: string; amount: number; targetDate: string | null },
  ): Promise<GoalRow> {
    const { rows } = await client.query<GoalRow>(
      `INSERT INTO public.goals (user_id, account_id, amount, target_date)
       VALUES ($1, $2, $3, $4)
       RETURNING ${GOAL_COLUMNS}`,
      [userId, input.accountId, input.amount, input.targetDate],
    );
    return rows[0];
  }

  async update(
    client: PoolClient,
    id: string,
    userId: string,
    input: UpdateGoalInput,
  ): Promise<GoalRow | null> {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (input.amount !== undefined) {
      values.push(input.amount);
      sets.push(`amount = $${values.length}`);
    }
    if (input.targetDate !== undefined) {
      values.push(input.targetDate);
      sets.push(`target_date = $${values.length}`);
    }

    if (sets.length === 0) {
      const { rows } = await client.query<GoalRow>(
        `SELECT ${GOAL_COLUMNS} FROM public.goals WHERE id = $1 AND user_id = $2`,
        [id, userId],
      );
      return rows[0] ?? null;
    }

    sets.push('updated_at = now()');
    values.push(id, userId);

    const { rows } = await client.query<GoalRow>(
      `UPDATE public.goals
       SET ${sets.join(', ')}
       WHERE id = $${values.length - 1} AND user_id = $${values.length}
       RETURNING ${GOAL_COLUMNS}`,
      values,
    );
    return rows[0] ?? null;
  }

  async remove(client: PoolClient, id: string, userId: string): Promise<boolean> {
    const { rowCount } = await client.query(
      'DELETE FROM public.goals WHERE id = $1 AND user_id = $2',
      [id, userId],
    );
    return (rowCount ?? 0) > 0;
  }
}

export const goalsRepository = new GoalsRepository();
