import { categoriesRepository } from '@/modules/_categories/repository.js';
import { AppError } from '@/shared/appError.js';
import {
  isUuid,
  optionalDateOrNull,
  optionalStringOrNull,
  requireAmount,
  requireEnum,
  requireUuid,
} from '@/shared/validate.js';
import { operationsRepository, toOperationDto } from './repository.js';
import { OPERATION_TYPES } from './types.js';
import type {
  OperationDto,
  OperationType,
  OverviewOperationDto,
  SavingsOperationDto,
} from './types.js';

/**
 * Бизнес-логика операций: выборки по отчёту/набору отчётов, накопления,
 * создание, обновление и удаление.
 *
 * Проверка «отчёт свой» выполняется перед каждым чтением/записью операций
 * отчёта; сама операция всегда пишется с user_id из токена и удаляется/
 * обновляется только своего user_id.
 */
export class OperationsService {
  /**
   * GET /operations — два режима:
   *  1. ?reportId=&type=  → операции одного отчёта;
   *  2. ?reportIds=a,b,c  → сводка по набору отчётов для overview.
   */
  async list(
    userId: string,
    query: Record<string, unknown>,
  ): Promise<OperationDto[] | OverviewOperationDto[]> {
    if (typeof query.reportIds === 'string' && query.reportIds !== '') {
      return this.listByReports(query.reportIds, userId);
    }

    const reportId = requireUuid(query.reportId);
    const type = requireEnum<OperationType>(
      query.type,
      OPERATION_TYPES,
      'Некорректный тип операции',
    );

    await this.assertReport(reportId, userId);
    const rows = await operationsRepository.listByReport(reportId, type);
    return rows.map(toOperationDto);
  }

  /**
   * Режим ?reportIds=: csv из query; не-uuid токены отбрасываем (они всё
   * равно ничего не вернули бы из-за user_id-фильтра).
   */
  private async listByReports(raw: string, userId: string): Promise<OverviewOperationDto[]> {
    const reportIds = raw
      .split(',')
      .map((id) => id.trim())
      .filter(isUuid);
    return operationsRepository.listByReports(reportIds, userId);
  }

  /** GET /operations/savings (карточка «Накопления»). */
  async listSavings(userId: string): Promise<SavingsOperationDto[]> {
    const rows = await operationsRepository.listSavings(userId);
    return rows.map((row) => operationsRepository.toSavingsDto(row));
  }

  /** POST /operations — body: { reportId, type, amount, categoryId?, description?, date? }. */
  async create(userId: string, body: Record<string, unknown>): Promise<OperationDto> {
    const reportId = requireUuid(body.reportId, 'Некорректный идентификатор отчёта');
    const type = requireEnum<OperationType>(
      body.type,
      OPERATION_TYPES,
      'Некорректный тип операции',
    );
    const amount = requireAmount(body.amount, 'Сумма не может быть отрицательной', false);
    const description = optionalStringOrNull(body.description, 'Некорректное описание');
    const date = optionalDateOrNull(body.date, 'Дата должна быть в формате YYYY-MM-DD');
    const categoryId = await this.resolveCategoryId(body.categoryId, userId);

    await this.assertReport(reportId, userId);

    const row = await operationsRepository.create(
      { reportId, type, amount, categoryId, description, date },
      userId,
    );
    return toOperationDto(row);
  }

  /**
   * PATCH /operations/:id — обновляем только переданные поля: случайный
   * null в запросе не стирает данные (клиент и так шлёт все поля целиком).
   */
  async update(userId: string, id: unknown, body: Record<string, unknown>): Promise<OperationDto> {
    const operationId = requireUuid(id);

    const input: {
      amount?: number;
      categoryId?: string | null;
      description?: string | null;
      type?: OperationType;
      date?: string | null;
    } = {};

    if (body.amount !== undefined) {
      input.amount = requireAmount(body.amount, 'Сумма не может быть отрицательной', false);
    }
    if (body.categoryId !== undefined) {
      input.categoryId = await this.resolveCategoryId(body.categoryId, userId);
    }
    if (body.description !== undefined) {
      input.description = optionalStringOrNull(body.description, 'Некорректное описание');
    }
    if (body.type !== undefined) {
      input.type = requireEnum<OperationType>(
        body.type,
        OPERATION_TYPES,
        'Некорректный тип операции',
      );
    }
    if (body.date !== undefined) {
      input.date = optionalDateOrNull(body.date, 'Дата должна быть в формате YYYY-MM-DD');
    }

    if (Object.keys(input).length === 0) {
      throw new AppError('Не передано ни одного поля для обновления', 400);
    }

    const row = await operationsRepository.update(operationId, userId, input);
    if (!row) {
      throw new AppError('Операция не найдена', 404);
    }
    return toOperationDto(row);
  }

  /** DELETE /operations/:id → 204/404. */
  async remove(userId: string, id: unknown): Promise<void> {
    const operationId = requireUuid(id);
    const removed = await operationsRepository.remove(operationId, userId);
    if (!removed) {
      throw new AppError('Операция не найдена', 404);
    }
  }

  /** Категория: null допустим (без категории), иначе — своя, иначе 400. */
  private async resolveCategoryId(value: unknown, userId: string): Promise<string | null> {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const categoryId = requireUuid(value, 'Некорректный идентификатор категории');
    if (!(await categoriesRepository.isOwned(userId, categoryId))) {
      // Чужую категорию не подводим: отвечаем явной ошибкой той же формы.
      throw new AppError('Категория не найдена', 400);
    }
    return categoryId;
  }

  /** 404 «Отчёт не найден» и для чужого отчёта — не подсказываем о существовании. */
  private async assertReport(reportId: string, userId: string): Promise<void> {
    if (!(await operationsRepository.isReportOwned(reportId, userId))) {
      throw new AppError('Отчёт не найден', 404);
    }
  }
}

export const operationsService = new OperationsService();
