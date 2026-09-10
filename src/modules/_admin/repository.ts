import { pool } from '@/db/pool.js';
import type {
  AdminDashboardStats,
  AdminDynamicsRow,
  AdminLogEndpointStat,
  AdminLogsMetrics,
  AdminLogsPage,
  AdminUserRow,
  DatabaseSize,
  LogsPeriod,
  LogsStatusFilter,
  LogsUserFilter,
} from './types.js';

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

  // ── Логи запросов (public.request_logs) ────────────────────────────────────

  /**
   * Страница логов для админки. Фильтр по статусу — whitelist из
   * LogsStatusFilter, мапится в условие status < 400 / >= 400; фильтр по
   * автору — LogsUserFilter (все / без авторизации / конкретный пользователь).
   * Email автора тянется LEFT JOIN по public.users: у строк без авторизации
   * (user_id is null) он остаётся null.
   */
  async getLogs(
    filter: LogsStatusFilter,
    user: LogsUserFilter,
    page: number,
    limit: number,
  ): Promise<AdminLogsPage> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter === 'success') {
      conditions.push(`rl.status < 400`);
    } else if (filter === 'error') {
      conditions.push(`rl.status >= 400`);
    }
    if (user.kind === 'anonymous') {
      conditions.push(`rl.is_authenticated = false`);
    } else if (user.kind === 'user') {
      params.push(user.userId);
      conditions.push(`rl.user_id = $${params.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows: countRows } = await pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM public.request_logs rl ${where}`,
      params,
    );

    params.push(limit, (page - 1) * limit);
    const { rows } = await pool.query<{
      id: string;
      created_at: string;
      method: string;
      path: string;
      query: unknown;
      body: unknown;
      status: number;
      duration_ms: number;
      response_body: unknown;
      error: string | null;
      user_id: string | null;
      is_authenticated: boolean;
      user_email: string | null;
      ip: string | null;
      user_agent: string | null;
    }>(
      `SELECT rl.id, rl.created_at, rl.method, rl.path, rl.query, rl.body, rl.status,
              rl.duration_ms, rl.response_body, rl.error, rl.user_id, rl.is_authenticated,
              u.email AS user_email, host(rl.ip) AS ip, rl.user_agent
       FROM public.request_logs rl
       LEFT JOIN public.users u ON u.id = rl.user_id
       ${where}
       ORDER BY rl.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return {
      items: rows.map((row) => ({
        id: Number(row.id),
        createdAt: row.created_at,
        method: row.method,
        path: row.path,
        query: row.query,
        body: row.body,
        status: row.status,
        durationMs: row.duration_ms,
        responseBody: row.response_body,
        error: row.error,
        userId: row.user_id,
        userEmail: row.user_email,
        isAuthenticated: row.is_authenticated,
        ip: row.ip,
        userAgent: row.user_agent,
      })),
      total: Number(countRows[0]?.count ?? 0),
      page,
      limit,
    };
  }

  /**
   * Метрики по логам за период: счётчики, среднее/p95, топы эндпоинтов,
   * динамика (для 24h — по часам, иначе по дням). Период мапится в
   * PostgreSQL-интервал через whitelist — никакой строки от клиента в SQL
   * не подставляется.
   */
  async getLogsMetrics(period: LogsPeriod): Promise<AdminLogsMetrics> {
    const intervalMap: Record<Exclude<LogsPeriod, 'all'>, string> = {
      '24h': '24 hours',
      '7d': '7 days',
      '30d': '30 days',
    };
    const where = period === 'all' ? '' : `WHERE created_at >= now() - interval '${intervalMap[period]}'`;
    const seriesTrunc = period === '24h' ? 'hour' : 'day';

    const totalsQuery = pool.query<{
      total: string;
      success_count: string;
      error_count: string;
      avg_duration_ms: string | null;
      p95_duration_ms: string | null;
    }>(
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE status < 400) AS success_count,
              count(*) FILTER (WHERE status >= 400) AS error_count,
              avg(duration_ms) AS avg_duration_ms,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_duration_ms
       FROM public.request_logs ${where}`,
    );

    const topSlowestQuery = pool.query<{
      endpoint: string;
      count: string;
      avg_duration_ms: string;
      error_count: string;
    }>(
      `SELECT method || ' ' || path AS endpoint, count(*) AS count,
              avg(duration_ms) AS avg_duration_ms,
              count(*) FILTER (WHERE status >= 400) AS error_count
       FROM public.request_logs ${where}
       GROUP BY 1
       ORDER BY avg(duration_ms) DESC
       LIMIT 5`,
    );

    const topErrorsQuery = pool.query<{
      endpoint: string;
      count: string;
      avg_duration_ms: string;
      error_count: string;
    }>(
      `SELECT method || ' ' || path AS endpoint, count(*) AS count,
              avg(duration_ms) AS avg_duration_ms,
              count(*) FILTER (WHERE status >= 400) AS error_count
       FROM public.request_logs
       ${where ? `${where} AND` : 'WHERE'} status >= 400
       GROUP BY 1
       ORDER BY count(*) DESC
       LIMIT 5`,
    );

    const seriesQuery = pool.query<{ point: string; total: string; errors: string }>(
      `SELECT date_trunc('${seriesTrunc}', created_at) AS point,
              count(*) AS total,
              count(*) FILTER (WHERE status >= 400) AS errors
       FROM public.request_logs ${where}
       GROUP BY 1
       ORDER BY 1 ASC`,
    );

    const [totals, topSlowest, topErrors, series] = await Promise.all([
      totalsQuery,
      topSlowestQuery,
      topErrorsQuery,
      seriesQuery,
    ]);

    const t = totals.rows[0];
    const total = Number(t?.total ?? 0);
    const errorCount = Number(t?.error_count ?? 0);

    const toEndpointStat = (row: {
      endpoint: string;
      count: string;
      avg_duration_ms: string;
      error_count: string;
    }): AdminLogEndpointStat => ({
      endpoint: row.endpoint,
      count: Number(row.count),
      avgDurationMs: Math.round(Number(row.avg_duration_ms)),
      errorCount: Number(row.error_count),
    });

    return {
      period,
      total,
      successCount: Number(t?.success_count ?? 0),
      errorCount,
      errorRate: total > 0 ? Math.round((errorCount / total) * 1000) / 1000 : null,
      avgDurationMs: t?.avg_duration_ms == null ? null : Math.round(Number(t.avg_duration_ms)),
      p95DurationMs: t?.p95_duration_ms == null ? null : Math.round(Number(t.p95_duration_ms)),
      topSlowestEndpoints: topSlowest.rows.map(toEndpointStat),
      topErrorEndpoints: topErrors.rows.map(toEndpointStat),
      perPoint: series.rows.map((row) => ({
        point: new Date(row.point).toISOString(),
        total: Number(row.total),
        errors: Number(row.errors),
      })),
    };
  }
}

export const adminRepository = new AdminRepository();
