import { withAccountTransaction } from '@/shared/accountRules.js';
import { pool } from '@/db/pool.js';
import { toIsoString } from '@/shared/serialize.js';
import type { CategoryDto, CategoryRow, CategoryType, UpdateCategoryInput } from './types.js';

export function toCategoryDto(row: CategoryRow): CategoryDto {
  return {
    id: row.id,
    user_id: row.user_id,
    type: row.type,
    name: row.name,
    color: row.color,
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
  };
}

export class CategoriesRepository {

  async list(userId: string, type?: CategoryType): Promise<CategoryRow[]> {
    const { rows } = type
      ? await pool.query<CategoryRow>(
          `SELECT * FROM public.categories
           WHERE user_id = $1 AND type = $2
           ORDER BY created_at`,
          [userId, type],
        )
      : await pool.query<CategoryRow>(
          `SELECT * FROM public.categories
           WHERE user_id = $1
           ORDER BY created_at`,
          [userId],
        );
    return rows;
  }

  async create(
    userId: string,
    type: CategoryType,
    name: string,
    color: string | null,
  ): Promise<CategoryRow> {
    const { rows } = await pool.query<CategoryRow>(
      `INSERT INTO public.categories (user_id, type, name, color)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, type, name, color],
    );
    return rows[0];
  }

  async update(
    id: string,
    userId: string,
    input: UpdateCategoryInput,
  ): Promise<CategoryRow | null> {

    const sets: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) {
      values.push(input.name);
      sets.push(`name = $${values.length}`);
    }
    if (input.color !== undefined) {
      values.push(input.color);
      sets.push(`color = $${values.length}`);
    }

    if (sets.length === 0) {

      const { rows } = await pool.query<CategoryRow>(
        'SELECT * FROM public.categories WHERE id = $1 AND user_id = $2',
        [id, userId],
      );
      return rows[0] ?? null;
    }

    sets.push('updated_at = now()');
    values.push(id, userId);

    const { rows } = await pool.query<CategoryRow>(
      `UPDATE public.categories
       SET ${sets.join(', ')}
       WHERE id = $${values.length - 1} AND user_id = $${values.length}
       RETURNING *`,
      values,
    );
    return rows[0] ?? null;
  }

  async remove(id: string, userId: string): Promise<boolean> {
    return withAccountTransaction(userId, async (client) => {
      const { rowCount } = await client.query(
        'DELETE FROM public.categories WHERE id = $1 AND user_id = $2',
        [id, userId],
      );
      return (rowCount ?? 0) > 0;
    });
  }
}

export const categoriesRepository = new CategoriesRepository();
