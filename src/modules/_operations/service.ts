import type { PoolClient } from 'pg';
import {
  assertOperationAccountsOpen,
  requirePrimaryAccount,
  withAccountTransaction,
} from '@/shared/accountRules.js';
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
  CategorySummaryRowDto,
  OperationDto,
  OperationType,
  OverviewOperationDto,
  OperationAccounts,
  UpdateOperationInput,
} from './types.js';

export class OperationsService {

  async list(
    userId: string,
    query: Record<string, unknown>,
  ): Promise<OperationDto[] | OverviewOperationDto[]> {

    let types: OperationType[] | undefined;
    if (query.type !== undefined) {
      if (typeof query.type !== 'string' || query.type === '') {
        throw new AppError('Некорректный тип операции', 400);
      }
      types = query.type
        .split(',')
        .map((part) =>
          requireEnum<OperationType>(part.trim(), OPERATION_TYPES, 'Некорректный тип операции'),
        );
    }
    if (typeof query.reportIds === 'string' && query.reportIds !== '') {
      return this.listByReports(query.reportIds, userId);
    }
    if (!types) throw new AppError('Некорректный тип операции', 400);
    const reportId = requireUuid(query.reportId, 'Некорректный идентификатор отчёта');

    await this.assertReport(reportId, userId);
    const rows = await operationsRepository.listByReport(reportId, types);
    return rows.map(toOperationDto);
  }

  private async listByReports(raw: string, userId: string): Promise<OverviewOperationDto[]> {
    const reportIds = raw
      .split(',')
      .map((id) => id.trim())
      .filter(isUuid);
    return operationsRepository.listByReports(reportIds, userId);
  }

  async getCategorySummary(
    userId: string,
    query: Record<string, unknown>,
  ): Promise<CategorySummaryRowDto[]> {
    if (typeof query.reportIds !== 'string' || query.reportIds === '') {
      return [];
    }
    const reportIds = query.reportIds
      .split(',')
      .map((id) => id.trim())
      .filter(isUuid);
    return operationsRepository.categorySummary(reportIds, userId);
  }

  async create(userId: string, body: Record<string, unknown>): Promise<OperationDto> {
    return withAccountTransaction(userId, async (client) => {
      const reportId = requireUuid(body.reportId, 'Некорректный идентификатор отчёта');
      const type = requireEnum<OperationType>(
        body.type,
        OPERATION_TYPES,
        'Некорректный тип операции',
      );

      const accountId =
        type !== 'transfer' && body.account_id === undefined
          ? await requirePrimaryAccount(client, userId)
          : body.account_id;
      const accounts = await this.resolveAccounts(client, userId, type, {
        account_id: accountId,
        from_account_id: body.from_account_id,
        to_account_id: body.to_account_id,
      });
      const amount = requireAmount(body.amount, 'Сумма не может быть отрицательной', false);
      const description = optionalStringOrNull(body.description, 'Некорректное описание');
      const date = optionalDateOrNull(body.date, 'Дата должна быть в формате YYYY-MM-DD');

      const categoryId =
        type === 'transfer' ? null : await this.resolveCategoryId(body.categoryId, userId, client);

      await this.assertReport(reportId, userId, client);
      const row = await operationsRepository.create(
        { reportId, type, amount, categoryId, description, date, ...accounts },
        userId,
        client,
      );
      return toOperationDto(row);
    });
  }

  async update(userId: string, id: unknown, body: Record<string, unknown>): Promise<OperationDto> {
    return withAccountTransaction(userId, async (client) => {
      const operationId = requireUuid(id);
      const current = await this.requireEditableOperation(client, userId, operationId);
      const type = requireEnum<OperationType>(
        body.type === undefined ? current.type : body.type,
        OPERATION_TYPES,
        'Некорректный тип операции',
      );
      if (type !== current.type && (type === 'transfer' || current.type === 'transfer')) {
        throw new AppError(
          'Нельзя преобразовать перевод в обычную операцию или наоборот',
          400,
          'INVALID_OPERATION_TYPE_CHANGE',
        );
      }
      const fields = [
        'amount',
        'categoryId',
        'description',
        'type',
        'date',
        ...(type === 'transfer'
          ? ['from_account_id', 'to_account_id', 'category_id']
          : ['account_id']),
      ];
      if (!fields.some((field) => body[field] !== undefined)) {
        throw new AppError('Не передано ни одного поля для обновления', 400);
      }

      const input: UpdateOperationInput = await this.resolveAccounts(client, userId, type, {
        account_id: body.account_id === undefined ? current.account_id : body.account_id,
        from_account_id:
          body.from_account_id === undefined ? current.from_account_id : body.from_account_id,
        to_account_id:
          body.to_account_id === undefined ? current.to_account_id : body.to_account_id,
      });
      if (body.amount !== undefined) {
        input.amount = requireAmount(body.amount, 'Сумма не может быть отрицательной', false);
      }
      if (type === 'transfer') {
        input.categoryId = null;
      } else if (body.categoryId !== undefined) {
        input.categoryId = await this.resolveCategoryId(body.categoryId, userId, client);
      }
      if (body.description !== undefined) {
        input.description = optionalStringOrNull(body.description, 'Некорректное описание');
      }
      if (body.type !== undefined) input.type = type;
      if (body.date !== undefined) {
        input.date = optionalDateOrNull(body.date, 'Дата должна быть в формате YYYY-MM-DD');
      }
      const row = await operationsRepository.update(operationId, userId, input, client);
      if (!row) throw new AppError('Операция не найдена', 404);
      return toOperationDto(row);
    });
  }

  private async resolveAccounts(
    client: PoolClient,
    userId: string,
    type: OperationType,
    values: { account_id: unknown; from_account_id: unknown; to_account_id: unknown },
  ): Promise<OperationAccounts> {
    const accounts: OperationAccounts = {
      account_id: null,
      from_account_id: null,
      to_account_id: null,
    };
    let ids: string[];
    if (type === 'transfer') {
      accounts.from_account_id = requireUuid(
        values.from_account_id,
        'Некорректный счёт списания',
      ).toLowerCase();
      accounts.to_account_id = requireUuid(
        values.to_account_id,
        'Некорректный счёт зачисления',
      ).toLowerCase();
      if (accounts.from_account_id === accounts.to_account_id) {
        throw new AppError('Счета перевода должны различаться', 400);
      }
      ids = [accounts.from_account_id, accounts.to_account_id];
    } else {
      accounts.account_id = requireUuid(
        values.account_id,
        'Некорректный счёт операции',
      ).toLowerCase();
      ids = [accounts.account_id];
    }
    const rows = await operationsRepository.getOwnedAccounts(client, userId, ids);
    if (rows.length !== ids.length) throw new AppError('Счёт не найден', 400);
    if (rows.some((row) => row.is_closed)) {
      throw new AppError('Нельзя выбрать закрытый счёт для операции', 400, 'ACCOUNT_CLOSED');
    }
    return accounts;
  }

  async remove(userId: string, id: unknown): Promise<void> {
    return withAccountTransaction(userId, async (client) => {
      const operationId = requireUuid(id);
      await this.requireEditableOperation(client, userId, operationId);
      const removed = await operationsRepository.remove(operationId, userId, client);
      if (!removed) {
        throw new AppError('Операция не найдена', 404);
      }
    });
  }

  private async requireEditableOperation(client: PoolClient, userId: string, id: string) {
    const row = await operationsRepository.getById(id, userId, client);
    if (!row) throw new AppError('Операция не найдена', 404);
    await assertOperationAccountsOpen(client, [
      row.account_id,
      row.from_account_id,
      row.to_account_id,
    ]);
    return row;
  }

  private async resolveCategoryId(
    value: unknown,
    userId: string,
    client: PoolClient,
  ): Promise<string | null> {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const categoryId = requireUuid(value, 'Некорректный идентификатор категории');
    if (!(await operationsRepository.isCategoryAllowed(client, userId, categoryId))) {

      throw new AppError('Категория не найдена', 400);
    }
    return categoryId;
  }

  private async assertReport(reportId: string, userId: string, client?: PoolClient): Promise<void> {
    if (!(await operationsRepository.isReportOwned(reportId, userId, client))) {
      throw new AppError('Отчёт не найден', 404);
    }
  }
}

export const operationsService = new OperationsService();
