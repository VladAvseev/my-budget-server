import { pool } from '@/db/pool.js';
import type {
  HomeBootstrap,
  OnboardingState,
  PublicUser,
  UpdateProfileInput,
  UserRow,
  UserSummary,
} from './types.js';

/**
 * «Сырая» строка большого CTE-запроса bootstrap: numeric-суммы pg отдаёт
 * строками, ::int-счётчики — числами, jsonb-агрегаты — разобранными структурами
 * (pg парсит jsonb через JSON.parse).
 */
interface HomeBootstrapRow {
  start_balance: string;
  currency: string | null;
  onboarded: boolean;
  income: string;
  expense: string;
  savings: string;
  daily: string;
  accumulations_total: string;
  last_report_id: string | null;
  last_report_name: string | null;
  last_report_start: string | null;
  last_report_end: string | null;
  last_income: string | null;
  last_expense: string | null;
  last_savings: string | null;
  last_daily: string | null;
  categories: number;
  reports: number;
  operations: number;
  savings_structure: unknown;
  goals: unknown;
}

/**
 * Преобразование строки БД в DTO для API-ответа:
 * убираем password_hash и переводим snake_case → camelCase
 * (клиентские типы исторически в camelCase, так UI не менять).
 */
export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    login: row.login,
    role: row.role,
    // numeric в драйвере pg — это всегда строка ("1500.50"), иначе теряется точность;
    // для балансов бытового масштаба double безопасно.
    startBalance: Number(row.start_balance),
    currency: row.currency,
    onboarded: row.onboarded,
    lastActiveAt: row.last_active_at ? row.last_active_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class UsersRepository {
  /** Полный профиль по id; null — пользователя нет (ид был из подделанного JWT). */
  async getById(id: string): Promise<UserRow | null> {
    const { rows } = await pool.query<UserRow>('SELECT * FROM public.users WHERE id = $1', [id]);
    return rows[0] ?? null;
  }

  /**
   * Выборочное обновление профиля. Поля принимаются только из whitelist
   * (startBalance/currency/onboarded) — SQL-инъекция через имена полей
   * исключена, значения всегда уходят параметрами $n.
   */
  async update(id: string, input: UpdateProfileInput): Promise<UserRow | null> {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (input.startBalance !== undefined) {
      values.push(input.startBalance);
      sets.push(`start_balance = $${values.length}`);
    }
    if (input.currency !== undefined) {
      values.push(input.currency);
      sets.push(`currency = $${values.length}`);
    }
    if (input.onboarded !== undefined) {
      values.push(input.onboarded);
      sets.push(`onboarded = $${values.length}`);
    }

    // Нечего обновлять — просто возвращаем текущую строку (PATCH идемпотентен).
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

  /**
   * Счётчики для онбординг-чеклиста (порт get_onboarding_state из useOnboardingChecklist.sql):
   * сколько сущностей пользователь уже создал — UI по ней подсвечивает выполненные шаги.
   * count(*) приходит из pg строкой (bigint), поэтому ::int + Number().
   */
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

  /**
   * Сводка по всем операциям пользователя (порт get_user_summary из useGlobalBalance.sql):
   * суммы по типам за всё время, 'savings' минус 'savings_out' — чистые накопления.
   */
  async getSummary(userId: string): Promise<UserSummary> {
    const { rows } = await pool.query<{
      income: string;
      expense: string;
      savings: string;
      daily: string;
    }>(
      `SELECT
         coalesce(sum(amount::numeric) FILTER (WHERE type = 'income'), 0)         AS income,
         coalesce(sum(amount::numeric) FILTER (WHERE type = 'expense'), 0)        AS expense,
         coalesce(sum(amount::numeric) FILTER (WHERE type = 'savings'), 0)
           - coalesce(sum(amount::numeric) FILTER (WHERE type = 'savings_out'), 0) AS savings,
         coalesce(sum(amount::numeric) FILTER (WHERE type = 'daily'), 0)          AS daily
       FROM public.operations
       WHERE user_id = $1`,
      [userId],
    );
    const row = rows[0];
    return {
      income: Number(row.income),
      expense: Number(row.expense),
      savings: Number(row.savings),
      daily: Number(row.daily),
    };
  }

  /**
   * Ответ главной за один round-trip (порт get_user_summary, get_onboarding_state,
   * _reports.getSummary и клиентских агрегатов карточек в один CTE-запрос).
   * Строка users гарантирована middleware'ом (401 до запроса); если строки нет —
   * вернётся null и сервис отдаст 404 (токен от удалённого аккаунта).
   */
  async getHomeBootstrap(userId: string): Promise<HomeBootstrap | null> {
    const { rows } = await pool.query<HomeBootstrapRow>(
      `WITH
       totals AS (
         SELECT
           coalesce(sum(amount::numeric) FILTER (WHERE type = 'income'), 0)          AS income,
           coalesce(sum(amount::numeric) FILTER (WHERE type = 'expense'), 0)         AS expense,
           coalesce(sum(amount::numeric) FILTER (WHERE type = 'savings'), 0)
             - coalesce(sum(amount::numeric) FILTER (WHERE type = 'savings_out'), 0) AS savings,
           coalesce(sum(amount::numeric) FILTER (WHERE type = 'daily'), 0)           AS daily
         FROM public.operations
         WHERE user_id = $1
       ),
       acc AS (
         SELECT coalesce(sum(amount::numeric), 0) AS total
         FROM public.accumulations
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
           coalesce(sum(o.amount::numeric) FILTER (WHERE o.type = 'income'), 0)          AS income,
           coalesce(sum(o.amount::numeric) FILTER (WHERE o.type = 'expense'), 0)         AS expense,
           coalesce(sum(o.amount::numeric) FILTER (WHERE o.type = 'savings'), 0)
             - coalesce(sum(o.amount::numeric) FILTER (WHERE o.type = 'savings_out'), 0) AS savings,
           coalesce(sum(o.amount::numeric) FILTER (WHERE o.type = 'daily'), 0)           AS daily
         FROM public.operations o
         JOIN last_report lr ON lr.id = o.report_id
       ),
       counters AS (
         SELECT
           (SELECT count(*)::int FROM public.categories WHERE user_id = $1) AS categories,
           (SELECT count(*)::int FROM public.reports    WHERE user_id = $1) AS reports,
           (SELECT count(*)::int FROM public.operations WHERE user_id = $1) AS operations
       ),
        savings_by_cat AS (
          SELECT category_id, sum(signed_amount) AS amount
          FROM (
            SELECT category_id, amount::numeric AS signed_amount
            FROM public.accumulations
            WHERE user_id = $1
            UNION ALL
            SELECT category_id,
                   CASE WHEN type = 'savings_out' THEN -amount::numeric ELSE amount::numeric END
            FROM public.operations
            WHERE user_id = $1 AND type IN ('savings', 'savings_out')
          ) src
          GROUP BY category_id
        )
        SELECT
          u.start_balance, u.currency, u.onboarded,
          t.income, t.expense, t.savings, t.daily,
          a.total AS accumulations_total,
          lr.id AS last_report_id, lr.name AS last_report_name,
          lr.period_start AS last_report_start, lr.period_end AS last_report_end,
          ls.income AS last_income, ls.expense AS last_expense,
          ls.savings AS last_savings, ls.daily AS last_daily,
          c.categories, c.reports, c.operations,
          (SELECT jsonb_agg(jsonb_build_object(
                     'categoryId', s.category_id,
                     'name', cat.name,
                     'color', cat.color,
                     'amount', s.amount
                   ) ORDER BY s.amount DESC)
             FROM savings_by_cat s
             LEFT JOIN public.categories cat ON cat.id = s.category_id) AS savings_structure,
          (SELECT jsonb_agg(jsonb_build_object(
                     'categoryId', g.category_id,
                     'amount', g.amount
                   ) ORDER BY g.created_at)
             FROM public.goals g
            WHERE g.user_id = $1) AS goals
        FROM public.users u
        CROSS JOIN totals t
        CROSS JOIN acc a
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

    // pg разбирать jsonb через JSON.parse: получаем JS-массивы, numeric внутри
    // становится числом; Number() — страховка от текстового формата.
    const savingsStructure = (row.savings_structure ?? []) as {
      categoryId: string | null;
      name: string | null;
      color: string | null;
      amount: string | number;
    }[];
    const goals = (row.goals ?? []) as { categoryId: string; amount: string | number }[];

    return {
      profile: {
        startBalance: Number(row.start_balance),
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
            // name NOT NULL в схеме — null здесь невозможен, но LEFT JOIN
            // типизации не доверяем, отдаём пустое имя вместо падения.
            name: row.last_report_name ?? '',
            period_start: row.last_report_start,
            period_end: row.last_report_end,
            summary: {
              income: Number(row.last_income),
              expense: Number(row.last_expense),
              savings: Number(row.last_savings),
              daily: Number(row.last_daily),
            },
          }
        : null,
      globalTotals: {
        income: Number(row.income),
        expense: Number(row.expense),
        savings: Number(row.savings),
        daily: Number(row.daily),
        accumulationsTotal: Number(row.accumulations_total),
      },
      savingsStructure: savingsStructure.map((item) => ({
        categoryId: item.categoryId,
        name: item.name,
        color: item.color,
        amount: Number(item.amount),
      })),
      goals: goals.map((item) => ({
        categoryId: item.categoryId,
        amount: Number(item.amount),
      })),
    };
  }
}

export const usersRepository = new UsersRepository();
