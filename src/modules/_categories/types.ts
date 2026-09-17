export interface CategoryRow {
  id: string;
  user_id: string;
  type: CategoryType;
  name: string;
  color: string | null;
  created_at: Date;
  updated_at: Date;
}

export type CategoryType = 'income' | 'expense' | 'savings';

export const CATEGORY_TYPES: readonly CategoryType[] = ['income', 'expense', 'savings'];

export interface CategoryDto {
  id: string;
  user_id: string;
  type: CategoryType;
  name: string;
  color: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateCategoryInput {
  type: CategoryType;
  name: string;
  color: string | null;
}

export interface UpdateCategoryInput {
  name?: string;
  color?: string | null;
}
