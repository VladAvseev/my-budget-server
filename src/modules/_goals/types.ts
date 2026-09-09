/**
 * Типы модуля goals (цели накоплений).
 *
 * Порт RPC Supabase: get_goals / create_goal / update_goal / delete_goal
 * (см. client/src/shared/hooks/useGoals.sql и
 * client/src/modules/_accumulations/api/use*Goal.sql).
 */

/** Строка таблицы `goals` как её отдаёт pg: одна цель на savings-категорию. */
export interface GoalRow {
  id: string;
  user_id: string;
  category_id: string;
  amount: string;
  /** Желаемая дата достижения ('YYYY-MM-DD' | null). */
  target_date: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Ответ API — копия jsonb_build_object из get_goals. */
export interface GoalDto {
  id: string;
  user_id: string;
  category_id: string;
  amount: number;
  target_date: string | null;
  created_at: string;
  updated_at: string;
}

/** POST /goals — клиентский GoalInput: { categoryId, amount, targetDate? }. */
export interface CreateGoalInput {
  categoryId: string;
  amount: number;
  targetDate: string | null;
}

/** PATCH /goals/:id — клиентский GoalUpdateInput (amount обязателен в модалке). */
export interface UpdateGoalInput {
  amount?: number;
  targetDate?: string | null;
}
