import { pool } from '@/db/pool.js';
import { toIsoString, toNumber } from '@/shared/serialize.js';
import type { GoalDto, GoalRow, UpdateGoalInput } from './types.js';

/**
 * Слой доступа к данным целей накоплений: список, создание, обновление,
 * удаление. В схеме goals есть unique(user_id, category_id) — «одна цель
 * на категорию».
 */

/** Явные колонки вместо SELECT *: состав не зависит от эволюции схемы. */
const GOAL_COLUMNS = `id, user_id, category_id, amount, target_date, created_at, updated_at`;

/** Строка БД → DTO ответа. */
export function toGoalDto(row: GoalRow): GoalDto {
  return {
    id: row.id,
    user_id: row.user_id,
    category_id: row.category_id,
    amount: toNumber(row.amount),
    target_date: row.target_date,
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
  };
}

export class GoalsRepository {
  /** get_goals(p_user_id): свои цели, новые сверху. */
  async list(userId: string): Promise<GoalRow[]> {
    const { rows } = await pool.query<GoalRow>(
      `SELECT ${GOAL_COLUMNS} FROM public.goals
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId],
    );
    return rows;
  }

  /** create_goal: дубль по (user_id, category_id) бросит 23505 — поймаем в сервисе. */
  async create(
    userId: string,
    input: { categoryId: string; amount: number; targetDate: string | null },
  ): Promise<GoalRow> {
    const { rows } = await pool.query<GoalRow>(
      `INSERT INTO public.goals (user_id, category_id, amount, target_date)
       VALUES ($1, $2, $3, $4)
       RETURNING ${GOAL_COLUMNS}`,
      [userId, input.categoryId, input.amount, input.targetDate],
    );
    return rows[0];
  }

  /** update_goal: только свои, только переданные поля (PATCH-семантика). */
  async update(id: string, userId: string, input: UpdateGoalInput): Promise<GoalRow | null> {
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
      const { rows } = await pool.query<GoalRow>(
        `SELECT ${GOAL_COLUMNS} FROM public.goals WHERE id = $1 AND user_id = $2`,
        [id, userId],
      );
      return rows[0] ?? null;
    }

    sets.push('updated_at = now()');
    values.push(id, userId);

    const { rows } = await pool.query<GoalRow>(
      `UPDATE public.goals
       SET ${sets.join(', ')}
       WHERE id = $${values.length - 1} AND user_id = $${values.length}
       RETURNING ${GOAL_COLUMNS}`,
      values,
    );
    return rows[0] ?? null;
  }

  /** Удаление цели с ownership-фильтром. */
  async remove(id: string, userId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      'DELETE FROM public.goals WHERE id = $1 AND user_id = $2',
      [id, userId],
    );
    return (rowCount ?? 0) > 0;
  }
}

export const goalsRepository = new GoalsRepository();
