import type { PoolClient } from 'pg';
import { AppError } from './appError.js';
import { withTransaction } from './transaction.js';

export async function lockActiveUser(client: PoolClient, userId: string): Promise<void> {
  const { rows } = await client.query<{ active: boolean }>(
    `SELECT login !~ '^deleted-[0-9a-f-]{36}$' AS active
     FROM public.users WHERE id = $1 FOR UPDATE`,
    [userId],
  );
  if (!rows[0]?.active) {
    throw new AppError('Пользователь удалён или не найден', 401, 'USER_UNAVAILABLE');
  }
}

export async function withAccountTransaction<T>(
  userId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  try {
    return await withTransaction(async (client) => {
      await lockActiveUser(client, userId);
      return fn(client);
    });
  } catch (error) {
    const pg = error as { code?: string; constraint?: string };
    const known = [
      'accounts_one_primary_key',
      'accounts_primary_open_check',
      'accounts_primary_required',
      'accounts_primary_protected',
    ];
    if (
      (pg.constraint && known.includes(pg.constraint)) ||
      pg.code === '40001' ||
      pg.code === '40P01'
    ) {
      throw new AppError(
        'Состояние счетов изменилось. Обновите данные и повторите действие',
        409,
        'ACCOUNT_CONFLICT',
      );
    }
    throw error;
  }
}

export async function requirePrimaryAccount(client: PoolClient, userId: string): Promise<string> {
  const { rows } = await client.query<{ id: string; is_closed: boolean }>(
    'SELECT id, is_closed FROM public.accounts WHERE user_id = $1 AND is_primary',
    [userId],
  );
  if (rows.length !== 1 || rows[0].is_closed) {
    throw new AppError(
      'У пользователя должен быть один открытый основной счёт',
      409,
      'PRIMARY_ACCOUNT_REQUIRED',
    );
  }
  return rows[0].id;
}

export async function assertOperationAccountsOpen(
  client: PoolClient,
  accountIds: Array<string | null>,
): Promise<void> {
  const { rows } = await client.query(
    'SELECT 1 FROM public.accounts WHERE id = ANY($1::uuid[]) AND is_closed LIMIT 1',
    [accountIds.filter((id): id is string => id !== null)],
  );
  if (rows.length) {
    throw new AppError(
      'Операцию закрытого счёта нельзя изменить или удалить. Сначала откройте счёт',
      400,
      'ACCOUNT_CLOSED',
    );
  }
}
