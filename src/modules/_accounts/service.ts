import { AppError } from '@/shared/appError.js';
import { requirePrimaryAccount, withAccountTransaction } from '@/shared/accountRules.js';
import { requireBoolean, requireNonEmptyString, requireUuid } from '@/shared/validate.js';
import type { PoolClient } from 'pg';
import { accountsRepository, toAccountDto } from './repository.js';
import type { AccountChanges } from './types.js';

function balanceInput(value: unknown): string {
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(String(value).trim()) ||
    !Number.isFinite(Number(value))
  ) {
    throw new AppError('Начальный баланс должен быть конечным числом', 400, 'INVALID_BALANCE');
  }
  return String(value).trim();
}

function validateBody(body: Record<string, unknown>, allowed: string[]): void {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !allowed.includes(key))
  ) {
    throw new AppError('Переданы неподдерживаемые поля счёта', 400, 'INVALID_ACCOUNT_FIELDS');
  }
}

export class AccountsService {
  async list(userId: string, filter: unknown) {
    if (filter !== undefined && filter !== 'true' && filter !== 'false') {
      throw new AppError('is_closed должен быть true или false', 400, 'INVALID_ACCOUNT_FILTER');
    }
    return (
      await accountsRepository.list(userId, filter === undefined ? undefined : filter === 'true')
    ).map(toAccountDto);
  }

  private async mustGet(userId: string, id: string, client?: PoolClient) {
    const row = await accountsRepository.get(userId, id, client);
    if (!row) throw new AppError('Счёт не найден', 404, 'ACCOUNT_NOT_FOUND');
    return row;
  }

  async get(userId: string, id: unknown) {
    return toAccountDto(await this.mustGet(userId, requireUuid(id)));
  }

  async create(userId: string, body: Record<string, unknown>) {
    validateBody(body, ['name', 'initial_balance', 'is_primary']);
    const name = requireNonEmptyString(body.name, 'Название счёта обязательно');
    const balance = body.initial_balance === undefined ? '0' : balanceInput(body.initial_balance);
    const primary =
      body.is_primary === undefined
        ? false
        : requireBoolean(body.is_primary, 'Некорректный признак основного счёта');
    return withAccountTransaction(userId, async (client) => {
      await requirePrimaryAccount(client, userId);
      const id = await accountsRepository.create(client, userId, name, balance);
      if (primary) await accountsRepository.makePrimary(client, userId, id);
      await requirePrimaryAccount(client, userId);
      return toAccountDto(await this.mustGet(userId, id, client));
    });
  }

  async update(userId: string, rawId: unknown, body: Record<string, unknown>) {
    const id = requireUuid(rawId);
    validateBody(body, ['name', 'initial_balance', 'is_closed', 'is_primary']);
    if (!Object.keys(body).length)
      throw new AppError('Не передано ни одного поля для обновления', 400);
    const input: AccountChanges = {};
    if (body.name !== undefined)
      input.name = requireNonEmptyString(body.name, 'Название счёта обязательно');
    if (body.initial_balance !== undefined)
      input.initial_balance = balanceInput(body.initial_balance);
    const closed =
      body.is_closed === undefined
        ? undefined
        : requireBoolean(body.is_closed, 'Некорректный признак закрытия счёта');
    if (body.is_primary !== undefined && body.is_primary !== true) {
      throw new AppError(
        'Чтобы сменить основной счёт, назначьте основным другой счёт',
        400,
        'PRIMARY_ACCOUNT_REQUIRED',
      );
    }
    return withAccountTransaction(userId, async (client) => {
      const before = await this.mustGet(userId, id, client);
      await requirePrimaryAccount(client, userId);
      if (closed === true && (before.is_primary || body.is_primary === true)) {
        throw new AppError('Основной счёт нельзя закрыть', 400, 'PRIMARY_ACCOUNT_PROTECTED');
      }
      if (closed === false) input.is_closed = false;
      await accountsRepository.update(client, userId, id, input);
      const current = await this.mustGet(userId, id, client);
      if (body.is_primary === true) {
        if (current.is_closed)
          throw new AppError(
            'Сначала откройте счёт, чтобы сделать его основным',
            400,
            'ACCOUNT_CLOSED',
          );
        await accountsRepository.makePrimary(client, userId, id);
      }
      if (closed === true && !before.is_closed) {
        if (!current.balance_is_zero)
          throw new AppError(
            'Закрыть можно только счёт с нулевым балансом',
            400,
            'ACCOUNT_BALANCE_NOT_ZERO',
          );
        await accountsRepository.update(client, userId, id, { is_closed: true });
      }
      await requirePrimaryAccount(client, userId);
      return toAccountDto(await this.mustGet(userId, id, client));
    });
  }

  async remove(userId: string, rawId: unknown): Promise<void> {
    const id = requireUuid(rawId);
    await withAccountTransaction(userId, async (client) => {
      const row = await this.mustGet(userId, id, client);
      if (row.is_primary)
        throw new AppError(
          'Основной счёт нельзя удалить. Сначала назначьте другой',
          400,
          'PRIMARY_ACCOUNT_PROTECTED',
        );
      if (await accountsRepository.hasOperations(client, id)) {
        throw new AppError('Счёт с операциями нельзя удалить', 400, 'ACCOUNT_HAS_OPERATIONS');
      }
      await accountsRepository.remove(client, userId, id);
      await requirePrimaryAccount(client, userId);
    });
  }
}
export const accountsService = new AccountsService();
