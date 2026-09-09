/**
 * Типы модуля accumulations.
 *
 * Порт RPC Supabase: get_accumulations / create_accumulation /
 * update_accumulation / delete_accumulation
 * (см. client/src/shared/hooks/useAccumulations.sql и
 * client/src/modules/_accumulations/api/*.sql).
 */

/** Строка таблицы `accumulations` как её отдаёт pg. */
export interface AccumulationRow {
  id: string;
  user_id: string;
  /** savings-категория, к которой относится пополнение (может быть null). */
  category_id: string | null;
  description: string;
  /** numeric → строка pg. */
  amount: string;
  created_at: Date;
  updated_at: Date;
}

/** Ответ API — копия jsonb_build_object из get_accumulations. */
export interface AccumulationDto {
  id: string;
  user_id: string;
  category_id: string | null;
  description: string;
  amount: number;
  created_at: string;
  updated_at: string;
}

/** POST /accumulations — клиентский AccumulationInput. */
export interface CreateAccumulationInput {
  amount: number;
  description: string;
  categoryId: string | null;
}

/** PATCH /accumulations/:id — клиентский AccumulationUpdateInput (всё опционально). */
export interface UpdateAccumulationInput {
  amount?: number;
  description?: string;
  categoryId?: string | null;
}
