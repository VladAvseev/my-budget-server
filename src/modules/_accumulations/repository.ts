import { pool } from '@/db/pool.js';
import { toIsoString, toNumber } from '@/shared/serialize.js';
import type { AccumulationDto, AccumulationRow, UpdateAccumulationInput } from './types.js';

/**
 * Слой доступа к данным накоплений: список, создание, обновление, удаление.
 * Доступ к чужим строкам отсекает параметр userId из JWT в каждом запросе.
 */

/** Строка БД → DTO ответа. */
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
  /** Свои накопления, новые сверху. */
  async list(userId: string): Promise<AccumulationRow[]> {
    const { rows } = await pool.query<AccumulationRow>(
      `SELECT * FROM public.accumulations
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId],
    );
    return rows;
  }

  /** Создание накопления: строка всегда привязана к пользователю из токена. */
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
   * Обновление с ownership-фильтром: меняются только переданные поля
   * (PATCH-семантика), случайный null не затирает данные.
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

  /** Удаление с ownership-фильтром. */
  async remove(id: string, userId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      'DELETE FROM public.accumulations WHERE id = $1 AND user_id = $2',
      [id, userId],
    );
    return (rowCount ?? 0) > 0;
  }
}

export const accumulationsRepository = new AccumulationsRepository();
