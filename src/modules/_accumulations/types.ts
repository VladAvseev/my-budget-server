/**
 * Типы модуля accumulations.
 *
 * Ответы — со snake_case-ключами, как их исторически получал клиент
 * (см. client/src/shared/api/types/domain.ts).
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

/** Ответ API с накоплением. */
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
