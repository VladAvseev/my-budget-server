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

export function isAnonymizedLogin(login: string): boolean {
  return /^deleted-[0-9a-f-]{36}$/.test(login);
}

export const NOT_ANONYMIZED_SQL = "login !~ '^deleted-[0-9a-f-]{36}$'";

interface HomeBootstrapRow {
  currency: string | null;
  onboarded: boolean;
  income: string;
  expense: string;
  last_report_id: string | null;
  last_report_name: string | null;
  last_report_start: string | null;
  last_report_end: string | null;
  last_income: string | null;
  last_expense: string | null;
  categories: number;
  reports: number;
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
    await client.query('DELETE FROM public.reports WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM public.categories WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM public.refresh_tokens WHERE user_id = $1', [userId]);
  }

  async getOnboardingState(userId: string): Promise<OnboardingState> {
    const { rows } = await pool.query<{
      categories: number;
      reports: number;
      operations: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM public.categories WHERE user_id = $1) AS categories,
         (SELECT count(*)::int FROM public.reports    WHERE user_id = $1) AS reports,
         (SELECT count(*)::int FROM public.operations WHERE user_id = $1) AS operations`,
      [userId],
    );
    const row = rows[0];
    return {
      categories: Number(row.categories),
      reports: Number(row.reports),
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

  async getHomeBootstrap(userId: string): Promise<HomeBootstrap | null> {
    const { rows } = await pool.query<HomeBootstrapRow>(
      `WITH
       totals AS (
         SELECT
           coalesce(sum(amount::numeric) FILTER (WHERE type = 'income'), 0)  AS income,
           coalesce(sum(amount::numeric) FILTER (WHERE type = 'expense'), 0) AS expense
         FROM public.operations
         WHERE user_id = $1
       ),
       last_report AS (
         SELECT id, name, period_start, period_end
         FROM public.reports
         WHERE user_id = $1
         ORDER BY period_end DESC NULLS LAST, period_start DESC NULLS LAST
         LIMIT 1
       ),
       last_summary AS (
         SELECT
           coalesce(sum(o.amount::numeric) FILTER (WHERE o.type = 'income'), 0)  AS income,
           coalesce(sum(o.amount::numeric) FILTER (WHERE o.type = 'expense'), 0) AS expense
         FROM public.operations o
         JOIN last_report lr ON lr.id = o.report_id
       ),
       counters AS (
         SELECT
           (SELECT count(*)::int FROM public.categories WHERE user_id = $1) AS categories,
           (SELECT count(*)::int FROM public.reports    WHERE user_id = $1) AS reports,
           (SELECT count(*)::int FROM public.operations WHERE user_id = $1) AS operations
       )
       SELECT
         u.currency, u.onboarded,
         t.income, t.expense,
         lr.id AS last_report_id, lr.name AS last_report_name,
         lr.period_start AS last_report_start, lr.period_end AS last_report_end,
         ls.income AS last_income, ls.expense AS last_expense,
         c.categories, c.reports, c.operations
       FROM public.users u
       CROSS JOIN totals t
       CROSS JOIN counters c
       LEFT JOIN last_report lr ON true
       LEFT JOIN last_summary ls ON true
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
        reports: row.reports,
        operations: row.operations,
      },
      lastReport: row.last_report_id
        ? {
            id: row.last_report_id,

            name: row.last_report_name ?? '',
            period_start: row.last_report_start,
            period_end: row.last_report_end,
            summary: {
              income: Number(row.last_income),
              expense: Number(row.last_expense),
            },
          }
        : null,
      globalTotals: {
        income: Number(row.income),
        expense: Number(row.expense),
      },
    };
  }
}

export const usersRepository = new UsersRepository();
