import { categoriesRepository } from '@/modules/_categories/repository.js';
import { AppError } from '@/shared/appError.js';
import { requireAmount, requireNonEmptyString, requireUuid } from '@/shared/validate.js';
import { accumulationsRepository, toAccumulationDto } from './repository.js';
import type { AccumulationDto, UpdateAccumulationInput } from './types.js';

/**
 * Бизнес-логика накоплений: создание, обновление, удаление, список.
 *
 * Формы клиента (CreateAccumulationModal / EditAccumulationModal) шлют
 * savings-категорию; проверка, что категория своя и именно savings —
 * здесь, на сервере.
 */

/** Категории накоплений — тип 'savings' из CHECK-констрейнта схемы. */
const SAVINGS_CATEGORY_TYPE = 'savings' as const;

export class AccumulationsService {
  /** GET /accumulations: список, новые сверху. */
  async list(userId: string): Promise<AccumulationDto[]> {
    const rows = await accumulationsRepository.list(userId);
    return rows.map(toAccumulationDto);
  }

  /** POST /accumulations — body: { amount, description, categoryId? }. */
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

  /** PATCH /accumulations/:id — body: { amount?, description?, categoryId? }. */
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

  /** DELETE /accumulations/:id → 204/404. */
  async remove(userId: string, id: unknown): Promise<void> {
    const accumulationId = requireUuid(id);
    const removed = await accumulationsRepository.remove(accumulationId, userId);
    if (!removed) {
      throw new AppError('Накопление не найдено', 404);
    }
  }

  /** Категория необязательна, но если указана — только своя savings-категория. */
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
