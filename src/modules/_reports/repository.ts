import type { PoolClient } from 'pg';
import { withAccountTransaction } from '@/shared/accountRules.js';
import { pool } from '@/db/pool.js';
import { toIsoString, toNumber } from '@/shared/serialize.js';
import { withTransaction } from '@/shared/transaction.js';
import type {
  CapitalMonthDto,
  CategoryLimitDto,
  CategoryLimitItem,
  CategoryLimitRow,
  CreateReportInput,
  ReportDto,
  ReportRow,
  ReportSummary,
} from './types.js';

/**
 * Слой доступа к данным отчётов, их сводок и лимитов категорий.
 *
 * Принадлежность строк пользователю обеспечивает сам сервер: каждый запрос
 * фильтрует по user_id, а проверка ownership отчёта вызывается из сервиса
 * перед операциями над вложенными ресурсами (summary/limits).
 */

/** Строка БД → DTO ответа (camelCase-ключи задаёт клиентский тип). */
export function toReportDto(row: ReportRow): ReportDto {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    code: row.code,
    period_start: row.period_start,
    period_end: row.period_end,
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
  };
}

/** Строка `category_limits` → DTO ответа. */
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

export class ReportsRepository {
  /** Список отчётов пользователя: новые (по началу периода) сверху. */
  async list(userId: string): Promise<ReportRow[]> {
    const { rows } = await pool.query<ReportRow>(
      `SELECT * FROM public.reports
       WHERE user_id = $1
       ORDER BY period_start DESC`,
      [userId],
    );
    return rows;
  }

  /** Отчёт по id: отдаём только его владельцу. */
  async getById(id: string, userId: string, client?: PoolClient): Promise<ReportRow | null> {
    const { rows } = await (client ?? pool).query<ReportRow>(
      'SELECT * FROM public.reports WHERE id = $1 AND user_id = $2',
      [id, userId],
    );
    return rows[0] ?? null;
  }

  /** Дешёвая проверка владения для assertReport (без чтения всей строки). */
  async existsOwned(id: string, userId: string): Promise<boolean> {
    const { rows } = await pool.query(
      'SELECT 1 FROM public.reports WHERE id = $1 AND user_id = $2',
      [id, userId],
    );
    return rows.length > 0;
  }

  /** Проверка уникальности кода периода до вставки (пустой код не учитывается). */
  async codeExists(userId: string, code: string): Promise<boolean> {
    const { rows } = await pool.query(
      "SELECT 1 FROM public.reports WHERE user_id = $1 AND code = $2 AND code <> ''",
      [userId, code],
    );
    return rows.length > 0;
  }

  /** Создание отчёта. Дубликат кода поймает и частичный unique-индекс (23505). */
  async create(userId: string, input: CreateReportInput): Promise<ReportRow> {
    const { rows } = await pool.query<ReportRow>(
      `INSERT INTO public.reports
         (user_id, name, code, period_start, period_end)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, input.name, input.code, input.periodStart, input.periodEnd],
    );
    return rows[0];
  }

  /** Частичное обновление отчёта: только переданные поля (REST-семантика PATCH). */
  async update(
    id: string,
    userId: string,
    patch: { name?: string; periodStart?: string | null; periodEnd?: string | null },
  ): Promise<ReportRow | null> {
    const sets: string[] = [];
    const values: unknown[] = [id, userId];
    if (patch.name !== undefined) {
      values.push(patch.name);
      sets.push(`name = $${values.length}`);
    }
    if (patch.periodStart !== undefined) {
      values.push(patch.periodStart);
      sets.push(`period_start = $${values.length}`);
    }
    if (patch.periodEnd !== undefined) {
      values.push(patch.periodEnd);
      sets.push(`period_end = $${values.length}`);
    }
    if (sets.length === 0) {
      return this.getById(id, userId);
    }
    sets.push('updated_at = now()');
    const { rows } = await pool.query<ReportRow>(
      `UPDATE public.reports
       SET ${sets.join(', ')}
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      values,
    );
    return rows[0] ?? null;
  }

  /** Удаление отчёта допускает обнуление ссылки даже у операций закрытых счетов. */
  async remove(id: string, userId: string): Promise<boolean> {
    return withAccountTransaction(userId, async (client) => {
      if (!(await this.getById(id, userId, client))) return false;
      // Явно сохраняем операции и при старом FK с ON DELETE CASCADE.
      await client.query('UPDATE public.operations SET report_id = NULL WHERE report_id = $1', [
        id,
      ]);
      const { rowCount } = await client.query(
        'DELETE FROM public.reports WHERE id = $1 AND user_id = $2',
        [id, userId],
      );
      return (rowCount ?? 0) > 0;
    });
  }

  /**
   * Сводка сумм по типам операций одного отчёта — тот же SQL, что в
   * getSummary-запросе модуля _users, только фильтр по report_id.
   * SUM() по пустой таблице даёт NULL, отсюда coalesce.
   */
  async getSummary(reportId: string): Promise<ReportSummary> {
    const { rows } = await pool.query<{
      income: string;
      expense: string;
      savings: string;
    }>(
      `SELECT
         coalesce(sum(amount::numeric) FILTER (WHERE type = 'income'), 0)          AS income,
         coalesce(sum(amount::numeric) FILTER (WHERE type = 'expense'), 0)         AS expense,
         coalesce(sum(amount::numeric) FILTER (WHERE type = 'savings'), 0)
           - coalesce(sum(amount::numeric) FILTER (WHERE type = 'savings_out'), 0) AS savings
       FROM public.operations
       WHERE report_id = $1`,
      [reportId],
    );
    const row = rows[0];
    return {
      income: Number(row.income),
      expense: Number(row.expense),
      savings: Number(row.savings),
    };
  }

  /**
   * Дельта капитала по периодам (отчётам): одна строка на отчёт — sum(income) −
   * sum(expense) всех его операций (переводы нулевые для капитала; пустой
   * отчёт даёт delta 0), месяц строки = месяц начала периода. Операции вне
   * отчётов в кривую не входят: деньги на балансе счетов они двигают, а точки
   * графика живут по периодам.
   */
  async listCapitalDynamics(userId: string): Promise<CapitalMonthDto[]> {
    const { rows } = await pool.query<{ month: string; delta: string }>(
      `SELECT to_char(date_trunc('month', r.period_start), 'YYYY-MM') AS month,
              coalesce(sum(o.amount::numeric) FILTER (WHERE o.type = 'income'), 0)
                - coalesce(
                    sum(o.amount::numeric) FILTER (WHERE o.type = 'expense'),
                    0
                  ) AS delta
         FROM public.reports r
         LEFT JOIN public.operations o ON o.report_id = r.id
        WHERE r.user_id = $1 AND r.period_start IS NOT NULL
        GROUP BY r.id, r.period_start
        ORDER BY r.period_start, min(r.created_at)`,
      [userId],
    );
    return rows.map((row) => ({ month: row.month, delta: Number(row.delta) }));
  }

  /** Лимиты категорий отчёта в порядке создания (старые сверху). */
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
   * Полная замена лимитов категорий в ОДНОЙ транзакции: pool.query без BEGIN
   * оставил бы отчёт без лимитов при падении вставки. Все строки — одним
   * multi-values INSERT (цикл по одному запросу давал N round-trip).
   */
  async replaceCategoryLimits(
    reportId: string,
    userId: string,
    limits: CategoryLimitItem[],
  ): Promise<CategoryLimitRow[]> {
    return withTransaction(async (client) => {
      await client.query('DELETE FROM public.category_limits WHERE report_id = $1', [reportId]);

      // Пустой список = «лимиты сброшены», дальше вставлять нечего.
      if (limits.length > 0) {
        const values: unknown[] = [reportId, userId];
        const tuples = limits.map((item) => {
          values.push(item.categoryId, item.amount);
          return `($1, $${values.length - 1}, $2, $${values.length})`;
        });
        await client.query(
          `INSERT INTO public.category_limits (report_id, category_id, user_id, amount)
           VALUES ${tuples.join(', ')}`,
          values,
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
}

export const reportsRepository = new ReportsRepository();
