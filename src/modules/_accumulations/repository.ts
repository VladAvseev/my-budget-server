import { pool } from '@/db/pool.js';
import { toIsoString, toNumber } from '@/shared/serialize.js';
import type { AccumulationDto, AccumulationRow, UpdateAccumulationInput } from './types.js';

/**
 * Слой доступа к данным накоплений (порт get/create/update/delete_accumulation).
 * В Supabase user_id подставлял auth.uid(), а доступ к чужим строкам отсекал
 * RLS; здесь то же самое делают параметр userId из JWT в каждом запросе.
 */

/** Строка БД → jsonb-подобный DTO (зеркало jsonb_build_object из RPC). */
export function toAccumulationDto(row: AccumulationRow): AccumulationDto {
  return {
    id: row.id,
    user_id: row.user_id,
    category_id: row.category_id,
    description: row.description,
    amount: toNumber(row.amount),
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
  };
}

export class AccumulationsRepository {
  /** get_accumulations(p_user_id): свои накопления, новые сверху. */
  async list(userId: string): Promise<AccumulationRow[]> {
    const { rows } = await pool.query<AccumulationRow>(
      `SELECT * FROM public.accumulations
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId],
    );
    return rows;
  }

  /** create_accumulation: строка всегда привязана к пользователю из токена. */
  async create(
    userId: string,
    amount: number,
    description: string,
    categoryId: string | null,
  ): Promise<AccumulationRow> {
    const { rows } = await pool.query<AccumulationRow>(
      `INSERT INTO public.accumulations (user_id, category_id, description, amount)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, categoryId, description, amount],
    );
    return rows[0];
  }

  /**
   * update_accumulation c ownership-фильтром. В отличие от RPC (затирал
   * все три поля всегда), обновляются только переданные — PATCH-семантика.
   */
  async update(
    id: string,
    userId: string,
    input: UpdateAccumulationInput,
  ): Promise<AccumulationRow | null> {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (input.amount !== undefined) {
      values.push(input.amount);
      sets.push(`amount = $${values.length}`);
    }
    if (input.description !== undefined) {
      values.push(input.description);
      sets.push(`description = $${values.length}`);
    }
    if (input.categoryId !== undefined) {
      values.push(input.categoryId);
      sets.push(`category_id = $${values.length}`);
    }

    if (sets.length === 0) {
      const { rows } = await pool.query<AccumulationRow>(
        'SELECT * FROM public.accumulations WHERE id = $1 AND user_id = $2',
        [id, userId],
      );
      return rows[0] ?? null;
    }

    sets.push('updated_at = now()');
    values.push(id, userId);

    const { rows } = await pool.query<AccumulationRow>(
      `UPDATE public.accumulations
       SET ${sets.join(', ')}
       WHERE id = $${values.length - 1} AND user_id = $${values.length}
       RETURNING *`,
      values,
    );
    return rows[0] ?? null;
  }

  /** delete_accumulation + RLS-фильтр. */
  async remove(id: string, userId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      'DELETE FROM public.accumulations WHERE id = $1 AND user_id = $2',
      [id, userId],
    );
    return (rowCount ?? 0) > 0;
  }
}

export const accumulationsRepository = new AccumulationsRepository();
