import { pool } from '@/db/pool.js';
import { toIsoString, toNumber } from '@/shared/serialize.js';
import type {
  AccumulationDto,
  AccumulationRow,
  GrowthMonthDto,
  UpdateAccumulationInput,
} from './types.js';

/** Явные колонки вместо SELECT *: порядок/состав не зависят от эволюции схемы. */
const ACCUMULATION_COLUMNS = `id, user_id, category_id, description, amount, created_at, updated_at`;

export function toAccumulationDto(row: AccumulationRow): AccumulationDto {
  return {
    id: row.id,
    user_id: row.user_id,
    category_id: row.category_id,
    description: row.description,
    amount: toNumber(row.amount),
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
  };
}

export class AccumulationsRepository {
  async list(userId: string): Promise<AccumulationRow[]> {
    const { rows } = await pool.query<AccumulationRow>(
      `SELECT ${ACCUMULATION_COLUMNS} FROM public.accumulations
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId],
    );
    return rows;
  }

  async getTotal(userId: string): Promise<number> {
    const { rows } = await pool.query<{ total: string }>(
      `SELECT coalesce(sum(amount::numeric), 0) AS total
         FROM public.accumulations
        WHERE user_id = $1`,
      [userId],
    );
    return Number(rows[0].total);
  }

  /**
   * Помесячная динамика роста накоплений для графика страницы: нетто
   * savings/savings_out-операций, свёрнутый в месяц начала периода отчёта
   * (историческая раскладка клиента), с нулевыми месяцами-заполнителями от
   * первого отчёта до текущего месяца. Клиент лишь кумулирует и добавляет
   * базу начальных накоплений — сырые операции на график больше не качаем.
   */
  async listGrowthDynamics(userId: string): Promise<GrowthMonthDto[]> {
    const { rows } = await pool.query<{ month: string; savings: string }>(
      `WITH bounds AS (
         SELECT date_trunc('month', min(period_start)) AS first_month,
                date_trunc('month', CURRENT_DATE)      AS current_month
           FROM public.reports
          WHERE user_id = $1
       ),
       by_month AS (
         SELECT date_trunc('month', r.period_start) AS month,
                coalesce(sum(o.amount::numeric) FILTER (WHERE o.type = 'savings'), 0)
                  - coalesce(sum(o.amount::numeric) FILTER (WHERE o.type = 'savings_out'), 0) AS savings
           FROM public.operations o
           JOIN public.reports r ON r.id = o.report_id
          WHERE o.user_id = $1
            AND o.type IN ('savings', 'savings_out')
            AND r.period_start IS NOT NULL
          GROUP BY 1
       )
       SELECT to_char(gs.month, 'YYYY-MM') AS month,
              coalesce(b.savings, 0)      AS savings
         FROM bounds bo
         CROSS JOIN LATERAL generate_series(
           bo.first_month, bo.current_month, interval '1 month'
         ) AS gs(month)
         LEFT JOIN by_month b ON b.month = gs.month
        ORDER BY gs.month`,
      [userId],
    );
    return rows.map((row) => ({ month: row.month, savings: Number(row.savings) }));
  }

  async create(
    userId: string,
    amount: number,
    description: string,
    categoryId: string | null,
  ): Promise<AccumulationRow> {
    const { rows } = await pool.query<AccumulationRow>(
      `INSERT INTO public.accumulations (user_id, category_id, description, amount)
       VALUES ($1, $2, $3, $4)
       RETURNING ${ACCUMULATION_COLUMNS}`,
      [userId, categoryId, description, amount],
    );
    return rows[0];
  }

  async update(
    id: string,
    userId: string,
    input: UpdateAccumulationInput,
  ): Promise<AccumulationRow | null> {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (input.amount !== undefined) {
      values.push(input.amount);
      sets.push(`amount = $${values.length}`);
    }
    if (input.description !== undefined) {
      values.push(input.description);
      sets.push(`description = $${values.length}`);
    }
    if (input.categoryId !== undefined) {
      values.push(input.categoryId);
      sets.push(`category_id = $${values.length}`);
    }

    if (sets.length === 0) {
      const { rows } = await pool.query<AccumulationRow>(
        `SELECT ${ACCUMULATION_COLUMNS} FROM public.accumulations WHERE id = $1 AND user_id = $2`,
        [id, userId],
      );
      return rows[0] ?? null;
    }

    sets.push('updated_at = now()');
    values.push(id, userId);

    const { rows } = await pool.query<AccumulationRow>(
      `UPDATE public.accumulations
       SET ${sets.join(', ')}
       WHERE id = $${values.length - 1} AND user_id = $${values.length}
       RETURNING ${ACCUMULATION_COLUMNS}`,
      values,
    );
    return rows[0] ?? null;
  }

  async remove(id: string, userId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      'DELETE FROM public.accumulations WHERE id = $1 AND user_id = $2',
      [id, userId],
    );
    return (rowCount ?? 0) > 0;
  }
}

export const accumulationsRepository = new AccumulationsRepository();
