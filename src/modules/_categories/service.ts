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

/**
 * Бизнес-логика категорий: создание, обновление и удаление.
 * Проверки формата полей — здесь, принадлежность строк владельцу —
 * в репозитории (фильтр `user_id = $me` в каждом запросе).
 */
export class CategoriesService {
  /** GET /categories?type= — список своих категорий, опциональная фильтрация по типу. */
  async list(userId: string, type?: string): Promise<CategoryDto[]> {
    // Тип из query валидируем только когда он передан: пустой ?type= = «все».
    const categoryType = type
      ? requireEnum<CategoryType>(type, CATEGORY_TYPES, 'Некорректный тип категории')
      : undefined;

    const rows = await categoriesRepository.list(userId, categoryType);
    return rows.map(toCategoryDto);
  }

  /** POST /categories — body: { type, name, color? }. */
  async create(userId: string, body: Record<string, unknown>): Promise<CategoryDto> {
    const type = requireEnum<CategoryType>(body.type, CATEGORY_TYPES, 'Некорректный тип категории');
    const name = requireNonEmptyString(body.name, 'Название категории обязательно');
    // Цвет опционален: форма AddCategoryModal умеет и без цвета.
    const color = optionalStringOrNull(body.color, 'Некорректный цвет категории');

    const row = await categoriesRepository.create(userId, type, name, color);
    return toCategoryDto(row);
  }

  /** PATCH /categories/:id — body: { name?, color? } (модалка EditCategoryModal). */
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
      // update с ownership-фильтром не нашёл строку — отвечаем 404.
      throw new AppError('Категория не найдена', 404);
    }
    return toCategoryDto(row);
  }

  /** DELETE /categories/:id — удаление своей категории (204/404). */
  async remove(userId: string, id: unknown): Promise<void> {
    const categoryId = requireUuid(id);
    const removed = await categoriesRepository.remove(categoryId, userId);
    if (!removed) {
      throw new AppError('Категория не найдена', 404);
    }
    // Операции с category_id = NULL после каскада (on delete set null) — как в схеме.
  }
}

export const categoriesService = new CategoriesService();
