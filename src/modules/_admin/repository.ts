import { pool } from '@/db/pool.js';
import { NOT_ANONYMIZED_SQL } from '@/modules/_users/repository.js';
import type {
  AdminChartMetric,
  AdminDashboardStats,
  AdminLogEndpointStat,
  AdminLogsDynamics,
  AdminLogsMetrics,
  AdminLogsPage,
  AdminOperationsDynamics,
  AdminUserOption,
  AdminUserRow,
  LogsAudience,
  LogsDynamicsBucket,
  LogsMethod,
  LogsPeriod,
  LogsSortField,
  LogsSortOrder,
  LogsStatusFilter,
  LogsUserFilter,
  OperationsDynamicsAggregation,
  StorageBreakdown,
} from './types.js';

export class AdminRepository {

  async getStats(): Promise<AdminDashboardStats> {
    const { rows } = await pool.query<{ data: AdminDashboardStats }>(
      `SELECT jsonb_build_object(
          'users', (
            SELECT jsonb_build_object(
              'total', count(*),
              'onboarded', count(*) FILTER (WHERE u.onboarded)
            )
            FROM public.users u
            WHERE ${NOT_ANONYMIZED_SQL}
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
            WHERE ${NOT_ANONYMIZED_SQL}
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
            WHERE ${NOT_ANONYMIZED_SQL}
          ),
         'operations', (
           SELECT jsonb_build_object(
             'total', count(*),
             'income', count(*) FILTER (WHERE o.type = 'income'),
             'expense', count(*) FILTER (WHERE o.type = 'expense'),
             'transfer', count(*) FILTER (WHERE o.type = 'transfer')
           )
           FROM public.operations o
         )
       ) AS data`,
    );

    return rows[0].data;
  }

  async getOperationsDynamics(
    audience: LogsAudience = 'all',
    metric: AdminChartMetric = 'count',
    aggregation: OperationsDynamicsAggregation = 'D',
  ): Promise<AdminOperationsDynamics> {
    const roleJoin =
      audience === 'users' ? `JOIN public.users au ON au.id = o.user_id AND au.role = 'user'` : '';
    const valueExpression = metric === 'unique_users' ? 'count(distinct o.user_id)' : 'count(*)';
    const trunc = aggregation === 'D' ? 'day' : aggregation === 'M' ? 'month' : 'year';
    const format = aggregation === 'D' ? 'YYYY-MM-DD' : aggregation === 'M' ? 'YYYY-MM' : 'YYYY';

    const [pointsResult, totalResult] = await Promise.all([
      pool.query<{ period: string; value: string }>(
        `SELECT
            to_char(
              date_trunc($1::text, o.created_at AT TIME ZONE 'Europe/Moscow'),
              $2
            ) AS period,
            ${valueExpression} AS value
          FROM public.operations o
          ${roleJoin}
          GROUP BY 1
          ORDER BY 1 ASC`,
        [trunc, format],
      ),
      pool.query<{ value: string }>(
        `SELECT ${valueExpression} AS value
           FROM public.operations o
           ${roleJoin}`,
      ),
    ]);

    return {
      audience,
      metric,
      aggregation,
      points: pointsResult.rows.map((row) => ({
        period: row.period,
        value: Number(row.value),
      })),
      total: Number(totalResult.rows[0]?.value ?? 0),
    };
  }

  async getLogsDynamics(
    audience: LogsAudience,
    metric: AdminChartMetric = 'count',
    bucket: LogsDynamicsBucket = 'hour',
  ): Promise<AdminLogsDynamics> {
    const where = audience === 'users' ? `WHERE rl.user_role = 'user'` : '';
    const valueExpression = metric === 'unique_users' ? 'count(distinct rl.user_id)' : 'count(*)';
    const trunc = bucket === 'hour' ? 'hour' : 'day';
    const format = bucket === 'hour' ? 'YYYY-MM-DD"T"HH24:00:00' : 'YYYY-MM-DD';

    const [pointsResult, totalResult] = await Promise.all([
      pool.query<{ period: string; value: string }>(
        `SELECT
            to_char(
              date_trunc($1::text, rl.created_at AT TIME ZONE 'Europe/Moscow'),
              $2
            ) AS period,
            ${valueExpression} AS value
          FROM public.request_logs rl
          ${where}
          GROUP BY 1
          ORDER BY 1 ASC`,
        [trunc, format],
      ),
      pool.query<{ value: string }>(
        `SELECT ${valueExpression} AS value
           FROM public.request_logs rl
           ${where}`,
      ),
    ]);

    return {
      audience,
      metric,
      bucket,
      points: pointsResult.rows.map((row) => ({
        period: row.period,
        value: Number(row.value),
      })),
      total: Number(totalResult.rows[0]?.value ?? 0),
    };
  }

  async getStorageBreakdown(): Promise<StorageBreakdown> {
    const [databaseResult, tablesResult] = await Promise.all([
      pool.query<{ database_bytes: string }>(
        `SELECT pg_database_size(current_database()) AS database_bytes`,
      ),
      pool.query<{ name: string; size_bytes: string }>(
        `SELECT c.relname AS name, pg_total_relation_size(c.oid) AS size_bytes
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relkind = 'r'
          ORDER BY pg_total_relation_size(c.oid) DESC`,
      ),
    ]);

    return {
      databaseBytes: Number(databaseResult.rows[0]?.database_bytes ?? 0),
      tables: tablesResult.rows.map((row) => ({
        name: row.name,
        sizeBytes: Number(row.size_bytes),
      })),
    };
  }

  async listUsers(): Promise<AdminUserRow[]> {
    const { rows } = await pool.query<{ data: AdminUserRow[] | null }>(
      `SELECT coalesce(jsonb_agg(jsonb_build_object(
        'user_id', u.id,
        'login', u.login,
        'last_active_at', u.last_active_at,
        'onboarded', u.onboarded,
        'operationsCount', coalesce(o.cnt, 0),
        'categoriesCount', coalesce(c.cnt, 0),
        'incomeCount', coalesce(o.income_cnt, 0),
        'expenseCount', coalesce(o.expense_cnt, 0),
        'transferCount', coalesce(o.transfer_cnt, 0),
        'accountsCount', coalesce(acc.cnt, 0),
        'goalsCount', coalesce(g.cnt, 0)
      )), '[]'::jsonb) AS data
      FROM public.users u
      LEFT JOIN (
        SELECT
          user_id,
          count(*) AS cnt,
          count(*) FILTER (WHERE type = 'income') AS income_cnt,
          count(*) FILTER (WHERE type = 'expense') AS expense_cnt,
          count(*) FILTER (WHERE type = 'transfer') AS transfer_cnt
        FROM public.operations
        GROUP BY user_id
      ) o ON o.user_id = u.id
      LEFT JOIN (
        SELECT user_id, count(*) AS cnt FROM public.categories GROUP BY user_id
      ) c ON c.user_id = u.id
      LEFT JOIN (
        SELECT user_id, count(*) AS cnt FROM public.accounts WHERE NOT is_closed GROUP BY user_id
      ) acc ON acc.user_id = u.id
      LEFT JOIN (
        SELECT g.user_id, count(*) AS cnt FROM public.goals g
        JOIN public.accounts a ON a.id = g.account_id AND a.user_id = g.user_id
        WHERE NOT a.is_closed GROUP BY g.user_id
      ) g ON g.user_id = u.id
      WHERE ${NOT_ANONYMIZED_SQL}`,
    );
    return rows[0].data ?? [];
  }

  async listUserOptions(): Promise<AdminUserOption[]> {
    const { rows } = await pool.query<{ user_id: string; login: string }>(
      `SELECT id AS user_id, login FROM public.users
        WHERE ${NOT_ANONYMIZED_SQL}
        ORDER BY login`,
    );
    return rows.map((row) => ({ userId: row.user_id, login: row.login }));
  }

  async getLogs(
    filter: LogsStatusFilter,
    user: LogsUserFilter,
    methods: LogsMethod[],
    page: number,
    limit: number,
    sort: LogsSortField = 'date',
    order: LogsSortOrder = 'desc',
  ): Promise<AdminLogsPage> {
    const sortColumn = sort === 'duration' ? 'rl.duration_ms' : 'rl.created_at';
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter === 'info') {
      conditions.push(`rl.status < 400`);
    } else if (filter === 'warning') {
      conditions.push(`rl.status >= 400 AND rl.status < 500`);
    } else if (filter === 'error') {
      conditions.push(`rl.status >= 500`);
    }
    if (user.kind === 'anonymous') {
      conditions.push(`rl.is_authenticated = false`);
    } else if (user.kind === 'user') {
      params.push(user.userId);
      conditions.push(`rl.user_id = $${params.length}`);
    }
    if (methods.length > 0) {
      params.push(methods);
      conditions.push(`rl.method = ANY($${params.length}::text[])`);
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
      status: number;
      duration_ms: number;
      error: string | null;
      user_id: string | null;
      is_authenticated: boolean;
      user_login: string | null;
    }>(
      `SELECT rl.id, rl.created_at, rl.method, rl.path, rl.status,
              rl.duration_ms, rl.error, rl.user_id, rl.is_authenticated,
              u.login AS user_login
       FROM public.request_logs rl
       LEFT JOIN public.users u ON u.id = rl.user_id
       ${where}
       ORDER BY ${sortColumn} ${sortOrder}, rl.id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return {
      items: rows.map((row) => ({
        id: Number(row.id),
        createdAt: row.created_at,
        method: row.method,
        path: row.path,
        status: row.status,
        durationMs: row.duration_ms,
        error: row.error,
        userId: row.user_id,
        userLogin: row.user_login,
        isAuthenticated: row.is_authenticated,
      })),
      total: Number(countRows[0]?.count ?? 0),
      page,
      limit,
    };
  }

  async getLogsMetrics(period: LogsPeriod): Promise<AdminLogsMetrics> {
    const intervalMap: Record<Exclude<LogsPeriod, 'all'>, string> = {
      '24h': '24 hours',
      '7d': '7 days',
      '30d': '30 days',
    };
    const where =
      period === 'all' ? '' : `WHERE created_at >= now() - interval '${intervalMap[period]}'`;

    const totalsQuery = pool.query<{
      total: string;
      info_count: string;
      warning_count: string;
      error_count: string;
      avg_duration_ms: string | null;
      p95_duration_ms: string | null;
    }>(
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE status < 400) AS info_count,
              count(*) FILTER (WHERE status >= 400 AND status < 500) AS warning_count,
              count(*) FILTER (WHERE status >= 500) AS error_count,
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
              count(*) FILTER (WHERE status >= 500) AS error_count
       FROM public.request_logs ${where}
       GROUP BY 1
       ORDER BY avg(duration_ms) DESC
       LIMIT 10`,
    );

    const topErrorsQuery = pool.query<{
      endpoint: string;
      count: string;
      avg_duration_ms: string;
      error_count: string;
    }>(
      `SELECT method || ' ' || path AS endpoint, count(*) AS count,
              avg(duration_ms) AS avg_duration_ms,
              count(*) FILTER (WHERE status >= 500) AS error_count
       FROM public.request_logs
       ${where ? `${where} AND` : 'WHERE'} status >= 500
       GROUP BY 1
       ORDER BY count(*) DESC
       LIMIT 10`,
    );

    const [totals, topSlowest, topErrors] = await Promise.all([
      totalsQuery,
      topSlowestQuery,
      topErrorsQuery,
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
      infoCount: Number(t?.info_count ?? 0),
      warningCount: Number(t?.warning_count ?? 0),
      errorCount,
      errorRate: total > 0 ? Math.round((errorCount / total) * 1000) / 1000 : null,
      avgDurationMs: t?.avg_duration_ms == null ? null : Math.round(Number(t.avg_duration_ms)),
      p95DurationMs: t?.p95_duration_ms == null ? null : Math.round(Number(t.p95_duration_ms)),
      topSlowestEndpoints: topSlowest.rows.map(toEndpointStat),
      topErrorEndpoints: topErrors.rows.map(toEndpointStat),
    };
  }
}

export const adminRepository = new AdminRepository();
