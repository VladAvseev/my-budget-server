import { categoriesRepository } from '@/modules/_categories/repository.js';
import { AppError } from '@/shared/appError.js';
import { optionalDateOrNull, requireAmount, requireUuid } from '@/shared/validate.js';
import { goalsRepository, toGoalDto } from './repository.js';
import type { GoalDto } from './types.js';

/**
 * Бизнес-логика целей накоплений: создание, обновление, удаление, список.
 *
 * Категория обязана быть своей и savings-типа
 * ('Категория не найдена среди категорий накоплений'); уникальность
 * «одна цель на категорию» держит partial unique index схемы. Обе проверки явные.
 */

const SAVINGS_CATEGORY_TYPE = 'savings' as const;

export class GoalsService {
  /** GET /goals: цели пользователя (новые сверху). */
  async list(userId: string): Promise<GoalDto[]> {
    const rows = await goalsRepository.list(userId);
    return rows.map(toGoalDto);
  }

  /** POST /goals — body: { categoryId, amount, targetDate? } (CreateGoalModal). */
  async create(userId: string, body: Record<string, unknown>): Promise<GoalDto> {
    const categoryId = requireUuid(body.categoryId, 'Некорректный идентификатор категории');
    // check (amount > 0) в схеме goals — валидируем до вставки ради 400, а не 500.
    const amount = requireAmount(body.amount, 'Сумма цели должна быть положительным числом');
    const targetDate = optionalDateOrNull(body.targetDate, 'Целевая дата в формате YYYY-MM-DD');

    // Проверка категории: своя + savings.
    if (!(await categoriesRepository.isOwned(userId, categoryId, SAVINGS_CATEGORY_TYPE))) {
      throw new AppError('Категория не найдена среди категорий накоплений', 400);
    }

    try {
      const row = await goalsRepository.create(userId, { categoryId, amount, targetDate });
      return toGoalDto(row);
    } catch (err) {
      // unique(user_id, category_id): цель на категорию уже заведена.
      if ((err as { code?: string }).code === '23505') {
        throw new AppError('Цель для этой категории уже существует', 409);
      }
      throw err;
    }
  }

  /** PATCH /goals/:id — body: { amount?, targetDate? } (EditGoalModal). */
  async update(userId: string, id: unknown, body: Record<string, unknown>): Promise<GoalDto> {
    const goalId = requireUuid(id);

    const input: { amount?: number; targetDate?: string | null } = {};
    if (body.amount !== undefined) {
      input.amount = requireAmount(body.amount, 'Сумма цели должна быть положительным числом');
    }
    if (body.targetDate !== undefined) {
      input.targetDate = optionalDateOrNull(body.targetDate, 'Целевая дата в формате YYYY-MM-DD');
    }

    if (Object.keys(input).length === 0) {
      throw new AppError('Не передано ни одного поля для обновления', 400);
    }

    const row = await goalsRepository.update(goalId, userId, input);
    if (!row) {
      throw new AppError('Цель не найдена', 404);
    }
    return toGoalDto(row);
  }

  /** DELETE /goals/:id → 204/404. */
  async remove(userId: string, id: unknown): Promise<void> {
    const goalId = requireUuid(id);
    const removed = await goalsRepository.remove(goalId, userId);
    if (!removed) {
      throw new AppError('Цель не найдена', 404);
    }
  }
}

export const goalsService = new GoalsService();
