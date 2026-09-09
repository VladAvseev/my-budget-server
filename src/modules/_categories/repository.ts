import { pool } from '@/db/pool.js';
import { toIsoString } from '@/shared/serialize.js';
import type { CategoryDto, CategoryRow, CategoryType, UpdateCategoryInput } from './types.js';

/**
 * Слой доступа к данным категорий.
 *
 * В Supabase это были RPC-функции, где принадлежность строки пользователю
 * обеспечивалась RLS-политиками (`user_id = auth.uid()`). Здесь вместо RLS
 * каждый SELECT/UPDATE/DELETE явно фильтруется по user_id из JWT.
 */

/** Строка БД → jsonb-подобный DTO (зеркало jsonb_build_object из RPC). */
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
  /**
   * Порт get_categories: категории пользователя, опционально по типу,
   * `order by created_at` (старые сверху — исторический порядок RPC).
   */
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

  /** Порт create_category: вставка с user_id из токена (вместо auth.uid()). */
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

  /**
   * Обновление только своих категорий: `WHERE id = $id AND user_id = $userId`.
   * Пустой набор полей (после фильтрации в сервисе) сюда не доходит.
   */
  async update(
    id: string,
    userId: string,
    input: UpdateCategoryInput,
  ): Promise<CategoryRow | null> {
    // Динамический SET собирается из whitelist-полей — имена колонок никогда
    // не приходят из запроса, значения всегда уходят параметрами $n.
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
      // Нечего обновлять — вернём текущую строку (PATCH идемпотентен).
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

  /** Порт delete_category с ownership-фильтром; rowCount=0 → чужой/несуществующий id. */
  async remove(id: string, userId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      'DELETE FROM public.categories WHERE id = $1 AND user_id = $2',
      [id, userId],
    );
    return (rowCount ?? 0) > 0;
  }

  /**
   * Проверка «эта категория — моя (и, опционально, нужного типа)» — общий
   * хелпер для _operations/_accumulations/_goals: в Supabase такой фильтр
   * обеспечивал RLS на таблицы+политики select, на сервере он явный.
   */
  async isOwned(userId: string, categoryId: string, type?: CategoryType): Promise<boolean> {
    const { rows } = type
      ? await pool.query(
          'SELECT 1 FROM public.categories WHERE id = $1 AND user_id = $2 AND type = $3',
          [categoryId, userId, type],
        )
      : await pool.query('SELECT 1 FROM public.categories WHERE id = $1 AND user_id = $2', [
          categoryId,
          userId,
        ]);
    return rows.length > 0;
  }
}

export const categoriesRepository = new CategoriesRepository();
