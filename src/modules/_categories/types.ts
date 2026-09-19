export interface CategoryRow {
  id: string;
  user_id: string;
  type: CategoryType;
  name: string;
  color: string | null;
  limit_amount: string | null;
  show_daily_limit: boolean;
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
  limit_amount: number | null;
  show_daily_limit: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateCategoryInput {
  type: CategoryType;
  name: string;
  color: string | null;
  limitAmount: number | null;
  showDailyLimit: boolean;
}

export interface UpdateCategoryInput {
  name?: string;
  color?: string | null;
  limitAmount?: number | null;
  showDailyLimit?: boolean;
}
