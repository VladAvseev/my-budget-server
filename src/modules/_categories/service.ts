import { AppError } from '@/shared/appError.js';
import {
  optionalStringOrNull,
  requireAmount,
  requireEnum,
  requireNonEmptyString,
  requireUuid,
} from '@/shared/validate.js';
import { categoriesRepository, toCategoryDto } from './repository.js';
import { CATEGORY_TYPES } from './types.js';
import type { CategoryDto, CategoryType } from './types.js';

function parseLimitAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return requireAmount(value, 'Лимит должен быть положительным числом');
}

function parseShowDailyLimit(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== 'boolean') {
    throw new AppError('Некорректный флаг дневного лимита', 400);
  }
  return value;
}

export class CategoriesService {

  async list(userId: string, type?: string): Promise<CategoryDto[]> {

    const categoryType = type
      ? requireEnum<CategoryType>(type, CATEGORY_TYPES, 'Некорректный тип категории')
      : undefined;

    const rows = await categoriesRepository.list(userId, categoryType);
    return rows.map(toCategoryDto);
  }

  async create(userId: string, body: Record<string, unknown>): Promise<CategoryDto> {
    const type = requireEnum<CategoryType>(body.type, CATEGORY_TYPES, 'Некорректный тип категории');
    const name = requireNonEmptyString(body.name, 'Название категории обязательно');

    const color = optionalStringOrNull(body.color, 'Некорректный цвет категории');
    const limitAmount = parseLimitAmount(body.limitAmount ?? body.limit_amount);
    const showDailyLimit = parseShowDailyLimit(
      body.showDailyLimit ?? body.show_daily_limit,
      false,
    );

    const row = await categoriesRepository.create(
      userId,
      type,
      name,
      color,
      limitAmount,
      showDailyLimit,
    );
    return toCategoryDto(row);
  }

  async update(userId: string, id: unknown, body: Record<string, unknown>): Promise<CategoryDto> {
    const categoryId = requireUuid(id);

    const input: { name?: string; color?: string | null; limitAmount?: number | null; showDailyLimit?: boolean } = {};
    if (body.name !== undefined) {
      input.name = requireNonEmptyString(body.name, 'Название категории обязательно');
    }
    if (body.color !== undefined) {
      input.color = optionalStringOrNull(body.color, 'Некорректный цвет категории');
    }
    if (body.limitAmount !== undefined || body.limit_amount !== undefined) {
      input.limitAmount = parseLimitAmount(
        body.limitAmount !== undefined ? body.limitAmount : body.limit_amount,
      );
    }
    if (body.showDailyLimit !== undefined || body.show_daily_limit !== undefined) {
      const raw = body.showDailyLimit !== undefined ? body.showDailyLimit : body.show_daily_limit;
      if (typeof raw !== 'boolean') {
        throw new AppError('Некорректный флаг дневного лимита', 400);
      }
      input.showDailyLimit = raw;
    }

    if (Object.keys(input).length === 0) {
      throw new AppError('Не передано ни одного поля для обновления', 400);
    }

    const row = await categoriesRepository.update(categoryId, userId, input);
    if (!row) {

      throw new AppError('Категория не найдена', 404);
    }
    return toCategoryDto(row);
  }

  async remove(userId: string, id: unknown): Promise<void> {
    const categoryId = requireUuid(id);
    const removed = await categoriesRepository.remove(categoryId, userId);
    if (!removed) {
      throw new AppError('Категория не найдена', 404);
    }

  }
}

export const categoriesService = new CategoriesService();
