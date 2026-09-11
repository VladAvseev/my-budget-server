import { categoriesRepository } from '@/modules/_categories/repository.js';
import { AppError } from '@/shared/appError.js';
import { requireAmount, requireNonEmptyString, requireUuid } from '@/shared/validate.js';
import { accumulationsRepository, toAccumulationDto } from './repository.js';
import type { AccumulationDto, AccumulationsTotal, UpdateAccumulationInput } from './types.js';

const SAVINGS_CATEGORY_TYPE = 'savings' as const;

export class AccumulationsService {
  async list(userId: string): Promise<AccumulationDto[]> {
    const rows = await accumulationsRepository.list(userId);
    return rows.map(toAccumulationDto);
  }

  async getTotal(userId: string): Promise<AccumulationsTotal> {
    const total = await accumulationsRepository.getTotal(userId);
    return { total };
  }

  async create(userId: string, body: Record<string, unknown>): Promise<AccumulationDto> {
    // 0 допустим (в схеме default 0 — накопление без суммы), отрицательные — нет.
    const amount = requireAmount(
      body.amount,
      'Сумма накопления не может быть отрицательной',
      false,
    );
    const description = requireNonEmptyString(body.description, 'Название накопления обязательно');
    const categoryId = await this.resolveCategoryId(body.categoryId, userId);

    const row = await accumulationsRepository.create(userId, amount, description, categoryId);
    return toAccumulationDto(row);
  }

  async update(
    userId: string,
    id: unknown,
    body: Record<string, unknown>,
  ): Promise<AccumulationDto> {
    const accumulationId = requireUuid(id);

    const input: UpdateAccumulationInput = {};
    if (body.amount !== undefined) {
      input.amount = requireAmount(
        body.amount,
        'Сумма накопления не может быть отрицательной',
        false,
      );
    }
    if (body.description !== undefined) {
      input.description = requireNonEmptyString(
        body.description,
        'Название накопления обязательно',
      );
    }
    if (body.categoryId !== undefined) {
      input.categoryId = await this.resolveCategoryId(body.categoryId, userId);
    }

    if (Object.keys(input).length === 0) {
      throw new AppError('Не передано ни одного поля для обновления', 400);
    }

    const row = await accumulationsRepository.update(accumulationId, userId, input);
    if (!row) {
      throw new AppError('Накопление не найдено', 404);
    }
    return toAccumulationDto(row);
  }

  async remove(userId: string, id: unknown): Promise<void> {
    const accumulationId = requireUuid(id);
    const removed = await accumulationsRepository.remove(accumulationId, userId);
    if (!removed) {
      throw new AppError('Накопление не найдено', 404);
    }
  }

  private async resolveCategoryId(value: unknown, userId: string): Promise<string | null> {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const categoryId = requireUuid(value, 'Некорректный идентификатор категории');
    if (!(await categoriesRepository.isOwned(userId, categoryId, SAVINGS_CATEGORY_TYPE))) {
      throw new AppError('Категория не найдена среди категорий накоплений', 400);
    }
    return categoryId;
  }
}

export const accumulationsService = new AccumulationsService();
