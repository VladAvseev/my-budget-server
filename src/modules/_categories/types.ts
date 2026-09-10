/**
 * Типы модуля categories.
 *
 * Ответы — со snake_case-ключами, как их исторически ожидает клиент
 * (см. client/src/shared/api/types/domain.ts), чтобы миграция свелась
 * к замене URL, а не переименованию полей в UI.
 */

/** Строка таблицы `categories` ровно как её отдаёт pg (см. db/schema.sql). */
export interface CategoryRow {
  id: string;
  user_id: string;
  type: CategoryType;
  name: string;
  color: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Типы категории — CHECK-констрейнт `categories_type_check` в схеме. */
export type CategoryType = 'income' | 'expense' | 'savings';

export const CATEGORY_TYPES: readonly CategoryType[] = ['income', 'expense', 'savings'];

/**
 * Ответ API с категорией: все ключи строки БД, даты — ISO-строки.
 */
export interface CategoryDto {
  id: string;
  user_id: string;
  type: CategoryType;
  name: string;
  color: string | null;
  created_at: string;
  updated_at: string;
}

/** POST /categories — клиентский CategoryCreateInput (type, name, color). */
export interface CreateCategoryInput {
  type: CategoryType;
  name: string;
  color: string | null;
}

/** PATCH /categories/:id — клиентский CategoryUpdateInput (name, color). */
export interface UpdateCategoryInput {
  name?: string;
  color?: string | null;
}
