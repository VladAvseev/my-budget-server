import { AppError } from '@/shared/appError.js';
import {
  optionalStringOrNull,
  requireEnum,
  requireNonEmptyString,
  requireUuid,
} from '@/shared/validate.js';
import { categoriesRepository, toCategoryDto } from './repository.js';
import { CATEGORY_TYPES } from './types.js';
import type { CategoryDto, CategoryType } from './types.js';

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

    const row = await categoriesRepository.create(userId, type, name, color);
    return toCategoryDto(row);
  }

  async update(userId: string, id: unknown, body: Record<string, unknown>): Promise<CategoryDto> {
    const categoryId = requireUuid(id);

    const input: { name?: string; color?: string | null } = {};
    if (body.name !== undefined) {
      input.name = requireNonEmptyString(body.name, 'Название категории обязательно');
    }
    if (body.color !== undefined) {
      input.color = optionalStringOrNull(body.color, 'Некорректный цвет категории');
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
