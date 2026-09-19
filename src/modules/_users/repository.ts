import { pool } from '@/db/pool.js';
import type { PoolClient } from 'pg';
import type {
  HomeBootstrap,
  OnboardingState,
  PublicUser,
  UpdateProfileInput,
  UserRow,
  UserSummary,
} from './types.js';

export type HomeBootstrapBase = Omit<HomeBootstrap, 'goalsSummary'>;

export function isAnonymizedLogin(login: string): boolean {
  return /^deleted-[0-9a-f-]{36}$/.test(login);
}

export const NOT_ANONYMIZED_SQL = "login !~ '^deleted-[0-9a-f-]{36}$'";

interface HomeBootstrapRow {
  currency: string | null;
  onboarded: boolean;
  income: string;
  expense: string;
  current_income: string;
  current_expense: string;
  trailing_income: string;
  trailing_expense: string;
  categories: number;
  operations: number;
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    login: row.login,
    role: row.role,
    currency: row.currency,
    onboarded: row.onboarded,
    lastActiveAt: row.last_active_at ? row.last_active_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class UsersRepository {
  async getById(id: string): Promise<UserRow | null> {
    const { rows } = await pool.query<UserRow>('SELECT * FROM public.users WHERE id = $1', [id]);
    return rows[0] ?? null;
  }

  async update(id: string, input: UpdateProfileInput): Promise<UserRow | null> {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (input.currency !== undefined) {
      values.push(input.currency);
      sets.push(`currency = $${values.length}`);
    }
    if (input.onboarded !== undefined) {
      values.push(input.onboarded);
      sets.push(`onboarded = $${values.length}`);
    }

    if (sets.length === 0) {
      return this.getById(id);
    }

    sets.push('updated_at = now()');
    values.push(id);

    const { rows } = await pool.query<UserRow>(
      `UPDATE public.users SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values,
    );
    return rows[0] ?? null;
  }

  async anonymize(
    client: PoolClient,
    userId: string,
    unreachablePasswordHash: string,
  ): Promise<void> {
    await client.query(
      `UPDATE public.users
          SET login = 'deleted-' || id,
              password_hash = $2,
              role = 'user',
              currency = NULL,
              onboarded = false,
              last_active_at = NULL,
              failed_login_attempts = 0,
              locked_until = NULL,
              updated_at = now()
        WHERE id = $1`,
      [userId, unreachablePasswordHash],
    );

    await client.query(
      `DELETE FROM public.operations o WHERE o.user_id = $1 OR EXISTS (
      SELECT 1 FROM public.accounts a WHERE a.user_id = $1
      AND (a.id = o.account_id OR a.id = o.from_account_id OR a.id = o.to_account_id)
    )`,
      [userId],
    );
    await client.query('DELETE FROM public.accounts WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM public.categories WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM public.refresh_tokens WHERE user_id = $1', [userId]);
  }

  async getOnboardingState(userId: string): Promise<OnboardingState> {
    const { rows } = await pool.query<{
      categories: number;
      operations: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM public.categories WHERE user_id = $1) AS categories,
         (SELECT count(*)::int FROM public.operations WHERE user_id = $1) AS operations`,
      [userId],
    );
    const row = rows[0];
    return {
      categories: Number(row.categories),
      operations: Number(row.operations),
    };
  }

  async getSummary(userId: string): Promise<UserSummary> {
    const { rows } = await pool.query<{
      income: string;
      expense: string;
    }>(
      `SELECT
         coalesce(sum(amount::numeric) FILTER (WHERE type = 'income'), 0)  AS income,
         coalesce(sum(amount::numeric) FILTER (WHERE type = 'expense'), 0) AS expense
       FROM public.operations
       WHERE user_id = $1`,
      [userId],
    );
    const row = rows[0];
    return {
      income: Number(row.income),
      expense: Number(row.expense),
    };
  }

  async getHomeBootstrap(userId: string): Promise<HomeBootstrapBase | null> {
    const { rows } = await pool.query<HomeBootstrapRow>(
      `WITH bounds AS (
         SELECT
           date_trunc('month', CURRENT_DATE)::date AS month_start,
           (date_trunc('month', CURRENT_DATE) + interval '1 month' - interval '1 day')::date AS month_end,
           (date_trunc('month', CURRENT_DATE) - interval '12 months')::date AS trailing_start,
           (date_trunc('month', CURRENT_DATE) - interval '1 day')::date AS trailing_end
       ),
       totals AS (
         SELECT
           coalesce(sum(amount::numeric) FILTER (WHERE type = 'income'), 0)  AS income,
           coalesce(sum(amount::numeric) FILTER (WHERE type = 'expense'), 0) AS expense
         FROM public.operations
         WHERE user_id = $1
       ),
       current_summary AS (
         SELECT
           coalesce(sum(o.amount::numeric) FILTER (WHERE o.type = 'income'), 0)  AS income,
           coalesce(sum(o.amount::numeric) FILTER (WHERE o.type = 'expense'), 0) AS expense
         FROM public.operations o, bounds b
         WHERE o.user_id = $1 AND o.date >= b.month_start AND o.date <= b.month_end
       ),
       trailing_summary AS (
         SELECT
           coalesce(sum(o.amount::numeric) FILTER (WHERE o.type = 'income'), 0)  AS income,
           coalesce(sum(o.amount::numeric) FILTER (WHERE o.type = 'expense'), 0) AS expense
         FROM public.operations o, bounds b
         WHERE o.user_id = $1 AND o.date >= b.trailing_start AND o.date <= b.trailing_end
       ),
       counters AS (
         SELECT
           (SELECT count(*)::int FROM public.categories WHERE user_id = $1) AS categories,
           (SELECT count(*)::int FROM public.operations WHERE user_id = $1) AS operations
       )
       SELECT
         u.currency, u.onboarded,
         t.income, t.expense,
         cs.income AS current_income, cs.expense AS current_expense,
         ts.income AS trailing_income, ts.expense AS trailing_expense,
         c.categories, c.operations
       FROM public.users u
       CROSS JOIN totals t
       CROSS JOIN counters c
       CROSS JOIN current_summary cs
       CROSS JOIN trailing_summary ts
       WHERE u.id = $1`,
      [userId],
    );

    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      profile: {
        currency: row.currency,
        onboarded: row.onboarded,
      },
      onboarding: {
        categories: row.categories,
        operations: row.operations,
      },
      currentMonth: {
        income: Number(row.current_income),
        expense: Number(row.current_expense),
      },
      trailingYear: {
        income: Number(row.trailing_income),
        expense: Number(row.trailing_expense),
      },
      globalTotals: {
        income: Number(row.income),
        expense: Number(row.expense),
      },
    };
  }
}

export const usersRepository = new UsersRepository();
