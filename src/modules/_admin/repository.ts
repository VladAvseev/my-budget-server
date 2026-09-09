import { pool } from '@/db/pool.js';
import type { AdminDashboardStats, AdminDynamicsRow, AdminUserRow, DatabaseSize } from './types.js';

/**
 * Слой доступа к данным админ-панели.
 *
 * Отличия от Supabase-реализации (client/src/modules/_admin/**.sql):
 *   * вместо is_admin() внутри функций — middleware requireAdmin (роль из JWT);
 *   * вместо таблиц auth.users + profiles — единая таблица public.users
 *     (user_id → id, поля email/onboarded/last_active_at те же);
 *   * размер считаем от current_database(): сервер работает с одной БД,
 *     а исторический SUM() по всем базам кластера — артефакт Supabase.
 */
export class AdminRepository {
  /**
   * Порт admin_get_dashboard_stats: один запрос, сборка отчёта
   * jsonb_build_object'ом ровно как в RPC — TS-тип описывает результат.
   */
  async getStats(): Promise<AdminDashboardStats> {
    const { rows } = await pool.query<{ data: AdminDashboardStats }>(
      `SELECT jsonb_build_object(
         'users', (
           SELECT jsonb_build_object(
             'total', count(*),
             'withoutReports', count(*) FILTER (
               WHERE NOT EXISTS (
                 SELECT 1 FROM public.reports r WHERE r.user_id = u.id
               )
             ),
             'onboarded', count(*) FILTER (WHERE u.onboarded)
           )
           FROM public.users u
         ),
         'activity', (
           SELECT jsonb_build_object(
             'dau', count(*) FILTER (WHERE u.last_active_at >= now() - interval '1 day'),
             'wau', count(*) FILTER (WHERE u.last_active_at >= now() - interval '7 days'),
             'mau', count(*) FILTER (WHERE u.last_active_at >= now() - interval '30 days'),
             'qau', count(*) FILTER (WHERE u.last_active_at >= now() - interval '90 days'),
             'sau', count(*) FILTER (WHERE u.last_active_at >= now() - interval '180 days'),
             'yau', count(*) FILTER (WHERE u.last_active_at >= now() - interval '365 days')
           )
           FROM public.users u
         ),
         'churn', (
           SELECT jsonb_build_object(
             'inactive1d',  count(*) FILTER (WHERE u.last_active_at IS NULL OR u.last_active_at < now() - interval '1 day'),
             'inactive7d',  count(*) FILTER (WHERE u.last_active_at IS NULL OR u.last_active_at < now() - interval '7 days'),
             'inactive30d', count(*) FILTER (WHERE u.last_active_at IS NULL OR u.last_active_at < now() - interval '30 days'),
             'inactive90d', count(*) FILTER (WHERE u.last_active_at IS NULL OR u.last_active_at < now() - interval '90 days'),
             'inactive180d',count(*) FILTER (WHERE u.last_active_at IS NULL OR u.last_active_at < now() - interval '180 days'),
             'inactive365d',count(*) FILTER (WHERE u.last_active_at IS NULL OR u.last_active_at < now() - interval '365 days')
           )
           FROM public.users u
         ),
         'reports', (
           SELECT jsonb_build_object(
             'total', count(*),
             'withDailyExpenses', count(*) FILTER (WHERE r.has_daily_expenses)
           )
           FROM public.reports r
         ),
         'operations', (
           SELECT jsonb_build_object(
             'total', count(*),
             'income', count(*) FILTER (WHERE o.type = 'income'),
             'expense', count(*) FILTER (WHERE o.type = 'expense'),
             'daily', count(*) FILTER (WHERE o.type = 'daily'),
             'savings', count(*) FILTER (WHERE o.type IN ('savings', 'savings_out'))
           )
           FROM public.operations o
         )
       ) AS data`,
    );
    // jsonb парсится драйвером в объект; счётчики bigint внутри jsonb — числа.
    return rows[0].data;
  }

  /**
   * Порт admin_get_operations_dynamics: количество операций по дням.
   * created_at переводим в московское время до группировки — сутки графика
   * считаются по МСК (привычка клиента со времён RPC).
   */
  async getOperationsDynamics(): Promise<AdminDynamicsRow[]> {
    const { rows } = await pool.query<{ day: string; operations_count: string }>(
      `SELECT
         (o.created_at AT TIME ZONE 'Europe/Moscow')::date AS day,
         count(*) AS operations_count
       FROM public.operations o
       GROUP BY 1
       ORDER BY 1 ASC`,
    );
    // day — строка 'YYYY-MM-DD' (парсер DATE), count — bigint-строка.
    return rows.map((row) => ({ day: row.day, operations_count: Number(row.operations_count) }));
  }

  /** Порт admin_get_database_size для текущей базы сервера. */
  async getDatabaseSize(): Promise<DatabaseSize> {
    const { rows } = await pool.query<{ size_bytes: string; size_pretty: string }>(
      `SELECT pg_database_size(current_database()) AS size_bytes,
              pg_size_pretty(pg_database_size(current_database())) AS size_pretty`,
    );
    return { sizeBytes: Number(rows[0].size_bytes), sizePretty: rows[0].size_pretty };
  }

  /**
   * Порт admin_get_users: все пользователи со статистикой количества
   * сущностей (LEFT JOIN счётчиков, чтобы нули не терялись).
   */
  async listUsers(): Promise<AdminUserRow[]> {
    const { rows } = await pool.query<{ data: AdminUserRow[] | null }>(
      `SELECT coalesce(jsonb_agg(jsonb_build_object(
        'user_id', u.id,
        'email', u.email,
        'last_active_at', u.last_active_at,
        'onboarded', u.onboarded,
        'reportsCount', coalesce(r.cnt, 0),
        'operationsCount', coalesce(o.cnt, 0),
        'categoriesCount', coalesce(c.cnt, 0),
        'incomeCount', coalesce(o.income_cnt, 0),
        'dailyCount', coalesce(o.daily_cnt, 0),
        'expenseCount', coalesce(o.expense_cnt, 0),
        'savingsCount', coalesce(o.savings_cnt, 0),
        'accumulationsCount', coalesce(a.cnt, 0),
        'goalsCount', coalesce(g.cnt, 0)
      )), '[]'::jsonb) AS data
      FROM public.users u
      LEFT JOIN (
        SELECT user_id, count(*) AS cnt FROM public.reports GROUP BY user_id
      ) r ON r.user_id = u.id
      LEFT JOIN (
        SELECT
          user_id,
          count(*) AS cnt,
          count(*) FILTER (WHERE type = 'income') AS income_cnt,
          count(*) FILTER (WHERE type = 'daily') AS daily_cnt,
          count(*) FILTER (WHERE type = 'expense') AS expense_cnt,
          count(*) FILTER (WHERE type IN ('savings', 'savings_out')) AS savings_cnt
        FROM public.operations
        GROUP BY user_id
      ) o ON o.user_id = u.id
      LEFT JOIN (
        SELECT user_id, count(*) AS cnt FROM public.categories GROUP BY user_id
      ) c ON c.user_id = u.id
      LEFT JOIN (
        SELECT user_id, count(*) AS cnt FROM public.accumulations GROUP BY user_id
      ) a ON a.user_id = u.id
      LEFT JOIN (
        SELECT user_id, count(*) AS cnt FROM public.goals GROUP BY user_id
      ) g ON g.user_id = u.id`,
    );
    return rows[0].data ?? [];
  }
}

export const adminRepository = new AdminRepository();
