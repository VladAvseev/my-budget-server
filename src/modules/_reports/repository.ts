import { pool } from '@/db/pool.js';
import type { OperationRow } from '@/modules/_operations/types.js';
import { toIsoString, toNumber, toNumberOrNull } from '@/shared/serialize.js';
import { withTransaction } from '@/shared/transaction.js';
import type {
  CategoryLimitDto,
  CategoryLimitItem,
  CategoryLimitRow,
  CreateReportInput,
  ReportDto,
  ReportRow,
  ReportSummary,
} from './types.js';

/**
 * Слой доступа к данным отчётов, их сводок, лимитов категорий и daily-расходов.
 *
 * Принадлежность строк пользователю в Supabase обеспечивалась RLS
 * (`user_id = auth.uid()` на select/insert/update/delete); здесь вместо него
 * каждый запрос фильтрует по user_id, а проверка ownership отчёта вызывается
 * из сервиса перед операциями над вложенными ресурсами (summary/limits/daily).
 */

/** Строка БД → jsonb-подобный DTO (зеркало jsonb_build_object из RPC). */
export function toReportDto(row: ReportRow): ReportDto {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    code: row.code,
    has_daily_expenses: row.has_daily_expenses,
    daily_budget: toNumberOrNull(row.daily_budget),
    period_start: row.period_start,
    period_end: row.period_end,
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
  };
}

/** Строка `category_limits` → DTO (зеркало jsonb_build_object из limits-RPC). */
export function toCategoryLimitDto(row: CategoryLimitRow): CategoryLimitDto {
  return {
    id: row.id,
    report_id: row.report_id,
    category_id: row.category_id,
    user_id: row.user_id,
    amount: toNumber(row.amount),
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
  };
}

/** Колонки операции для вставки daily-расхода (DTO берём из _operations). */
const OPERATION_COLUMNS = `id, report_id, user_id, type, amount, category_id,
       description, date, created_at, updated_at`;

export class ReportsRepository {
  /**
   * Порт финальной продакшн-версии get_reports: `order by period_start desc`
   * (именно она перекрывала одноимённые более ранние варианты в functions.sql).
   */
  async list(userId: string): Promise<ReportRow[]> {
    const { rows } = await pool.query<ReportRow>(
      `SELECT * FROM public.reports
       WHERE user_id = $1
       ORDER BY period_start DESC`,
      [userId],
    );
    return rows;
  }

  /** get_report + RLS: отдаём отчёт только его владельцу. */
  async getById(id: string, userId: string): Promise<ReportRow | null> {
    const { rows } = await pool.query<ReportRow>(
      'SELECT * FROM public.reports WHERE id = $1 AND user_id = $2',
      [id, userId],
    );
    return rows[0] ?? null;
  }

  /** Проверка уникальности кода до вставки (порт exists-блока create_report). */
  async codeExists(userId: string, code: string): Promise<boolean> {
    const { rows } = await pool.query(
      "SELECT 1 FROM public.reports WHERE user_id = $1 AND code = $2 AND code <> ''",
      [userId, code],
    );
    return rows.length > 0;
  }

  /** Порт create_report. Дубликат кода поймает и частичный unique-индекс (23505). */
  async create(userId: string, input: CreateReportInput): Promise<ReportRow> {
    const { rows } = await pool.query<ReportRow>(
      `INSERT INTO public.reports
         (user_id, name, code, has_daily_expenses, daily_budget, period_start, period_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        userId,
        input.name,
        input.code,
        input.hasDailyExpenses,
        input.hasDailyExpenses ? input.dailyBudget : null,
        input.periodStart,
        input.periodEnd,
      ],
    );
    return rows[0];
  }

  /** Ветка p_name из update_report. */
  async rename(id: string, userId: string, name: string): Promise<ReportRow | null> {
    const { rows } = await pool.query<ReportRow>(
      `UPDATE public.reports
       SET name = $3, updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [id, userId, name],
    );
    return rows[0] ?? null;
  }

  /**
   * Ветки p_has_daily_expenses true/false из update_report: включение —
   * записать настройки, выключение — обнулить бюджет и период.
   */
  async setDailyExpenses(
    id: string,
    userId: string,
    enabled: boolean,
    dailyBudget: number | null,
    periodStart: string | null,
    periodEnd: string | null,
  ): Promise<ReportRow | null> {
    const { rows } = await pool.query<ReportRow>(
      `UPDATE public.reports
       SET has_daily_expenses = $3,
           daily_budget = $4,
           period_start = $5,
           period_end = $6,
           updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [
        id,
        userId,
        enabled,
        enabled ? dailyBudget : null,
        enabled ? periodStart : null,
        enabled ? periodEnd : null,
      ],
    );
    return rows[0] ?? null;
  }

  /** Порт delete_report; каскад schema.sql удалит операции и лимиты. */
  async remove(id: string, userId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      'DELETE FROM public.reports WHERE id = $1 AND user_id = $2',
      [id, userId],
    );
    return (rowCount ?? 0) > 0;
  }

  /**
   * Порт get_report_summary (тот же SQL, что get_user_summary в _users,
   * только фильтр по report_id). SUM() по пустой таблице → NULL, отсюда coalesce.
   */
  async getSummary(reportId: string): Promise<ReportSummary> {
    const { rows } = await pool.query<{
      income: string;
      expense: string;
      savings: string;
      daily: string;
    }>(
      `SELECT
         coalesce(sum(amount::numeric) FILTER (WHERE type = 'income'), 0)          AS income,
         coalesce(sum(amount::numeric) FILTER (WHERE type = 'expense'), 0)         AS expense,
         coalesce(sum(amount::numeric) FILTER (WHERE type = 'savings'), 0)
           - coalesce(sum(amount::numeric) FILTER (WHERE type = 'savings_out'), 0) AS savings,
         coalesce(sum(amount::numeric) FILTER (WHERE type = 'daily'), 0)           AS daily
       FROM public.operations
       WHERE report_id = $1`,
      [reportId],
    );
    const row = rows[0];
    return {
      income: Number(row.income),
      expense: Number(row.expense),
      savings: Number(row.savings),
      daily: Number(row.daily),
    };
  }

  /** get_category_limits: лимиты отчёта, старые сверху (как в RPC). */
  async listCategoryLimits(reportId: string): Promise<CategoryLimitRow[]> {
    const { rows } = await pool.query<CategoryLimitRow>(
      `SELECT * FROM public.category_limits
       WHERE report_id = $1
       ORDER BY created_at`,
      [reportId],
    );
    return rows;
  }

  /** Сколько из переданных категорий принадлежат пользователю (для сверки со списком). */
  async countOwnedCategories(userId: string, categoryIds: string[]): Promise<number> {
    const { rows } = await pool.query<{ cnt: string }>(
      'SELECT count(*)::int AS cnt FROM public.categories WHERE user_id = $1 AND id = ANY($2::uuid[])',
      [userId, categoryIds],
    );
    return Number(rows[0].cnt);
  }

  /**
   * Порт set_category_limits: полная замена лимитов в ОДНОЙ транзакции
   * (plpgsql-функция в Supabase была транзакционной сама; pool.query без BEGIN
   * оставил бы отчёт без лимитов при падении вставки).
   */
  async replaceCategoryLimits(
    reportId: string,
    userId: string,
    limits: CategoryLimitItem[],
  ): Promise<CategoryLimitRow[]> {
    return withTransaction(async (client) => {
      await client.query('DELETE FROM public.category_limits WHERE report_id = $1', [reportId]);

      // Пустой список = «лимиты сброшены», дальше вставлять нечего (как `return '[]'` в RPC).
      for (const item of limits) {
        await client.query(
          `INSERT INTO public.category_limits (report_id, category_id, user_id, amount)
           VALUES ($1, $2, $3, $4)`,
          [reportId, item.categoryId, userId, item.amount],
        );
      }

      const { rows } = await client.query<CategoryLimitRow>(
        `SELECT * FROM public.category_limits
         WHERE report_id = $1
         ORDER BY created_at`,
        [reportId],
      );
      return rows;
    });
  }

  /**
   * Порт SELECT из create_daily_expense: первая дата периода, на которой ещё
   * нет daily-операции отчёта. generate_series по датам, NOT EXISTS по операциям.
   */
  async findFreeDailyDate(reportId: string, periodStart: string, periodEnd: string) {
    const { rows } = await pool.query<{ free_date: string | null }>(
      `SELECT d.date::date AS free_date
       FROM generate_series($1::date, $2::date, interval '1 day') AS d(date)
       WHERE NOT EXISTS (
         SELECT 1 FROM public.operations o
         WHERE o.report_id = $3 AND o.type = 'daily' AND o.date = d.date::date
       )
       ORDER BY d.date
       LIMIT 1`,
      [periodStart, periodEnd, reportId],
    );
    return rows[0]?.free_date ?? null;
  }

  /** INSERT daily-операции (category_id не заполняется — как в RPC). */
  async insertDailyExpense(
    reportId: string,
    userId: string,
    amount: number,
    description: string | null,
    date: string,
  ): Promise<OperationRow> {
    const { rows } = await pool.query<OperationRow>(
      `INSERT INTO public.operations (report_id, user_id, type, amount, description, date)
       VALUES ($1, $2, 'daily', $3, $4, $5)
       RETURNING ${OPERATION_COLUMNS}`,
      [reportId, userId, amount, description, date],
    );
    return rows[0];
  }

  /**
   * Порт disable_daily_expenses: удаление daily-операций + сброс настроек —
   * оба statement'а в одной транзакции.
   */
  async disableDailyExpenses(reportId: string): Promise<void> {
    await withTransaction(async (client) => {
      await client.query("DELETE FROM public.operations WHERE report_id = $1 AND type = 'daily'", [
        reportId,
      ]);
      await client.query(
        `UPDATE public.reports
         SET has_daily_expenses = false,
             daily_budget = null,
             period_start = null,
             period_end = null,
             updated_at = now()
         WHERE id = $1`,
        [reportId],
      );
    });
  }
}

export const reportsRepository = new ReportsRepository();
