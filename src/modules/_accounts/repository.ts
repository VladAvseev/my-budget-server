import { pool } from '@/db/pool.js';
import { toIsoString, toNumber } from '@/shared/serialize.js';
import type { PoolClient } from 'pg';
import type { AccountChanges, AccountDto, AccountRow } from './types.js';

const BALANCE = `a.initial_balance + coalesce((
  SELECT sum(
    CASE WHEN o.account_id = a.id AND o.type = 'income' THEN o.amount
         WHEN o.account_id = a.id AND o.type = 'expense' THEN -o.amount
         ELSE 0 END
    + CASE WHEN o.type = 'transfer' AND o.to_account_id = a.id THEN o.amount ELSE 0 END
    - CASE WHEN o.type = 'transfer' AND o.from_account_id = a.id THEN o.amount ELSE 0 END)
  FROM public.operations o
  WHERE o.account_id = a.id OR o.from_account_id = a.id OR o.to_account_id = a.id
), 0)`;
const SELECT = `SELECT a.*, b.balance, b.balance = 0 AS balance_is_zero
  FROM public.accounts a CROSS JOIN LATERAL (SELECT ${BALANCE} AS balance) b`;

export function toAccountDto(row: AccountRow): AccountDto {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    initial_balance: toNumber(row.initial_balance),
    balance: toNumber(row.balance),
    is_closed: row.is_closed,
    is_primary: row.is_primary,
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
  };
}

export class AccountsRepository {
  async list(userId: string, closed?: boolean): Promise<AccountRow[]> {
    const { rows } = await pool.query<AccountRow>(
      `${SELECT}
      WHERE a.user_id = $1 AND ($2::boolean IS NULL OR a.is_closed = $2)
      ORDER BY a.is_primary DESC, a.created_at, a.id`,
      [userId, closed ?? null],
    );
    return rows;
  }

  async get(userId: string, id: string, client?: PoolClient): Promise<AccountRow | null> {
    const { rows } = await (client ?? pool).query<AccountRow>(
      `${SELECT} WHERE a.user_id = $1 AND a.id = $2`,
      [userId, id],
    );
    return rows[0] ?? null;
  }

  async create(client: PoolClient, userId: string, name: string, balance: string): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO public.accounts (user_id, name, initial_balance)
       VALUES ($1, $2, $3::numeric) RETURNING id`,
      [userId, name, balance],
    );
    return rows[0].id;
  }

  async update(
    client: PoolClient,
    userId: string,
    id: string,
    input: AccountChanges,
  ): Promise<void> {
    const values: unknown[] = [userId, id];
    const sets: string[] = [];
    for (const key of ['name', 'initial_balance', 'is_closed'] as const) {
      if (input[key] !== undefined) {
        values.push(input[key]);
        sets.push(`${key} = $${values.length}`);
      }
    }
    if (sets.length) {
      await client.query(
        `UPDATE public.accounts SET ${sets.join(', ')}
        WHERE user_id = $1 AND id = $2`,
        values,
      );
    }
  }

  async makePrimary(client: PoolClient, userId: string, id: string): Promise<void> {
    await client.query(
      `UPDATE public.accounts SET is_primary = false
      WHERE user_id = $1 AND is_primary AND id <> $2`,
      [userId, id],
    );
    await client.query(
      `UPDATE public.accounts SET is_primary = true
      WHERE user_id = $1 AND id = $2 AND NOT is_primary`,
      [userId, id],
    );
  }

  async hasOperations(client: PoolClient, id: string): Promise<boolean> {
    const { rows } = await client.query(
      `SELECT 1 FROM public.operations
      WHERE account_id = $1 OR from_account_id = $1 OR to_account_id = $1 LIMIT 1`,
      [id],
    );
    return rows.length > 0;
  }

  async remove(client: PoolClient, userId: string, id: string): Promise<void> {
    await client.query('DELETE FROM public.accounts WHERE user_id = $1 AND id = $2', [userId, id]);
  }
}
export const accountsRepository = new AccountsRepository();
