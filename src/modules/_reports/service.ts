import { toOperationDto } from '@/modules/_operations/repository.js';
import type { OperationDto } from '@/modules/_operations/types.js';
import { AppError } from '@/shared/appError.js';
import {
  optionalDateOrNull,
  optionalStringOrNull,
  requireAmount,
  requireBoolean,
  requireNonEmptyString,
  requireUuid,
} from '@/shared/validate.js';
import { reportsRepository, toCategoryLimitDto, toReportDto } from './repository.js';
import type {
  CapitalMonthDto,
  CategoryLimitDto,
  CategoryLimitItem,
  ReportDto,
  ReportSummary,
} from './types.js';

/**
 * Бизнес-логика отчётов: создание/обновление, сводки, лимиты категорий
 * и daily-расходы.
 *
 * Тексты ошибок исторические ('Такой период уже существует',
 * 'Нет свободных дат в периоде') — клиент показывает их как есть, без маппинга.
 */

/** Ошибочный ответ «нет отчёта» для чужого id — не раскрываем существование. */
const NOT_FOUND = 'Отчёт не найден';

export class ReportsService {
  /** GET /reports: свои отчёты, новые (по периоду) сверху. */
  async list(userId: string): Promise<ReportDto[]> {
    const rows = await reportsRepository.list(userId);
    return rows.map(toReportDto);
  }

  /**
   * POST /reports.
   * Body (camelCase, как OperationInput/ReportInput клиента):
   * { name, code?, hasDailyExpenses?, dailyBudget?, periodStart?, periodEnd? }.
   */
  async create(userId: string, body: Record<string, unknown>): Promise<ReportDto> {
    const name = requireNonEmptyString(body.name, 'Название отчёта обязательно');

    // Пустой код — «не задан»: проверка дубликата нужна только непустым,
    // частичный unique-индекс в схеме — второй эшелон.
    const code = typeof body.code === 'string' ? body.code.trim() : '';

    const hasDailyExpenses =
      body.hasDailyExpenses === undefined
        ? false
        : requireBoolean(body.hasDailyExpenses, 'Некорректный флаг ежедневных расходов');

    // daily_budget имеет смысл только при включённом daily-режиме.
    const dailyBudget = hasDailyExpenses
      ? requireAmount(body.dailyBudget, 'Бюджет на день должен быть положительным числом')
      : null;

    const periodStart = optionalDateOrNull(
      body.periodStart,
      'Дата начала периода в формате YYYY-MM-DD',
    );
    const periodEnd = optionalDateOrNull(
      body.periodEnd,
      'Дата окончания периода в формате YYYY-MM-DD',
    );

    if (code !== '' && (await reportsRepository.codeExists(userId, code))) {
      throw new AppError('Такой период уже существует', 409);
    }

    try {
      const row = await reportsRepository.create(userId, {
        name,
        code,
        hasDailyExpenses,
        dailyBudget,
        periodStart,
        periodEnd,
      });
      return toReportDto(row);
    } catch (err) {
      // Гонка: два параллельных create с одним кодом — индекс поймает второго.
      if ((err as { code?: string }).code === '23505') {
        throw new AppError('Такой период уже существует', 409);
      }
      throw err;
    }
  }

  /** GET /reports/:id: только свой отчёт. */
  async getById(userId: string, id: unknown): Promise<ReportDto> {
    const reportId = requireUuid(id);
    const row = await reportsRepository.getById(reportId, userId);
    if (!row) {
      throw new AppError(NOT_FOUND, 404);
    }
    return toReportDto(row);
  }

  /**
   * PATCH /reports/:id: либо { name } (переименование), либо
   * { hasDailyExpenses, dailyBudget?, periodStart?, periodEnd? }
   * (включение/выключение daily-режима).
   */
  async update(userId: string, id: unknown, body: Record<string, unknown>): Promise<ReportDto> {
    const reportId = requireUuid(id);
    // Проверяем владение до модификации.
    if (!(await reportsRepository.getById(reportId, userId))) {
      throw new AppError(NOT_FOUND, 404);
    }

    if (body.name !== undefined) {
      const name = requireNonEmptyString(body.name, 'Название отчёта обязательно');
      const row = await reportsRepository.rename(reportId, userId, name);
      return toReportDto(this.must(row));
    }

    if (body.hasDailyExpenses !== undefined) {
      const enabled = requireBoolean(
        body.hasDailyExpenses,
        'Некорректный флаг ежедневных расходов',
      );
      const dailyBudget = enabled
        ? requireAmount(body.dailyBudget, 'Бюджет на день должен быть положительным числом')
        : null;
      const periodStart = optionalDateOrNull(
        body.periodStart,
        'Дата начала периода в формате YYYY-MM-DD',
      );
      const periodEnd = optionalDateOrNull(
        body.periodEnd,
        'Дата окончания периода в формате YYYY-MM-DD',
      );
      const row = await reportsRepository.setDailyExpenses(
        reportId,
        userId,
        enabled,
        dailyBudget,
        periodStart,
        periodEnd,
      );
      return toReportDto(this.must(row));
    }

    throw new AppError('Не передано ни одного поля для обновления', 400);
  }

  /** DELETE /reports/:id → 204/404. */
  async remove(userId: string, id: unknown): Promise<void> {
    const reportId = requireUuid(id);
    const removed = await reportsRepository.remove(reportId, userId);
    if (!removed) {
      throw new AppError(NOT_FOUND, 404);
    }
  }

  /** GET /reports/:id/summary (SummaryCards). */
  async getSummary(userId: string, id: unknown): Promise<ReportSummary> {
    const reportId = requireUuid(id);
    await this.assertReport(reportId, userId);
    return reportsRepository.getSummary(reportId);
  }

  /** GET /reports/capital-dynamics: помесячная дельта капитала пользователя. */
  async getCapitalDynamics(userId: string): Promise<CapitalMonthDto[]> {
    return reportsRepository.listCapitalDynamics(userId);
  }

  /** GET /reports/:id/category-limits. */
  async getCategoryLimits(userId: string, id: unknown): Promise<CategoryLimitDto[]> {
    const reportId = requireUuid(id);
    await this.assertReport(reportId, userId);
    const rows = await reportsRepository.listCategoryLimits(reportId);
    return rows.map(toCategoryLimitDto);
  }

  /**
   * PUT /reports/:id/category-limits: полная замена
   * списка. Body: { limits: [{ categoryId, amount }] }.
   * Категория лимита обязана быть своей — это проверяется явно,
   * до входа в транзакцию.
   */
  async setCategoryLimits(
    userId: string,
    id: unknown,
    body: Record<string, unknown>,
  ): Promise<CategoryLimitDto[]> {
    const reportId = requireUuid(id);
    await this.assertReport(reportId, userId);

    if (!Array.isArray(body.limits)) {
      throw new AppError('Ожидается массив limits', 400);
    }

    const limits: CategoryLimitItem[] = body.limits.map((rawItem) => {
      const item = (rawItem ?? {}) as Record<string, unknown>;
      return {
        categoryId: requireUuid(item.categoryId, 'Некорректный идентификатор категории'),
        amount: requireAmount(item.amount, 'Лимит должен быть положительным числом'),
      };
    });

    // Один запрос на все id: сколько категорий оказалось «своими».
    const uniqueIds = [...new Set(limits.map((item) => item.categoryId))];
    if (uniqueIds.length > 0) {
      const owned = await reportsRepository.countOwnedCategories(userId, uniqueIds);
      if (owned !== uniqueIds.length) {
        throw new AppError('Категория не найдена', 400);
      }
    }

    try {
      const rows = await reportsRepository.replaceCategoryLimits(reportId, userId, limits);
      return rows.map(toCategoryLimitDto);
    } catch (err) {
      // unique(report_id, category_id): одна категория дважды в присланном списке.
      if ((err as { code?: string }).code === '23505') {
        throw new AppError('Одна категория не может иметь два лимита', 400);
      }
      throw err;
    }
  }

  /**
   * POST /reports/:id/daily-expenses.
   * Период берём из строки отчёта, а не из тела запроса: клиент шлёт то же,
   * что уже лежит в базе, а базе верить надёжнее.
   * Вставка — на первую свободную дату периода.
   */
  async createDailyExpense(
    userId: string,
    id: unknown,
    body: Record<string, unknown>,
  ): Promise<OperationDto> {
    const reportId = requireUuid(id);
    const amount = requireAmount(body.amount, 'Сумма не может быть отрицательной', false);
    const description = optionalStringOrNull(body.description, 'Некорректное описание');

    const report = await reportsRepository.getById(reportId, userId);
    if (!report) {
      throw new AppError(NOT_FOUND, 404);
    }
    if (!report.has_daily_expenses || !report.period_start || !report.period_end) {
      throw new AppError('Ежедневные расходы не настроены', 400);
    }

    const freeDate = await reportsRepository.findFreeDailyDate(
      reportId,
      report.period_start,
      report.period_end,
    );
    if (!freeDate) {
      // Клиент показывает этот текст как есть.
      throw new AppError('Нет свободных дат в периоде', 400);
    }

    const row = await reportsRepository.insertDailyExpense(
      reportId,
      userId,
      amount,
      description,
      freeDate,
    );
    return toOperationDto(row);
  }

  /** DELETE /reports/:id/daily-expenses → 204 (в одной транзакции). */
  async disableDailyExpenses(userId: string, id: unknown): Promise<void> {
    const reportId = requireUuid(id);
    await this.assertReport(reportId, userId);
    await reportsRepository.disableDailyExpenses(reportId);
  }

  private async assertReport(reportId: string, userId: string): Promise<void> {
    if (!(await reportsRepository.existsOwned(reportId, userId))) {
      throw new AppError(NOT_FOUND, 404);
    }
  }

  /** Внутренний помощник: UPDATE после проверки владения не должен вернуть null. */
  private must<T>(row: T | null): T {
    if (!row) {
      throw new AppError(NOT_FOUND, 404);
    }
    return row;
  }
}

export const reportsService = new ReportsService();
