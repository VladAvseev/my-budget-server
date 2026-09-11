import { pool } from '@/db/pool.js';
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

/**
 * Слой доступа к данным админ-панели.
 *
 * Особенности:
 *   * права проверяет middleware requireAdmin (роль из JWT), а не SQL-функции;
 *   * все данные — из единой таблицы public.users (user_id → id);
 *   * размер БД считаем от current_database(): сервер работает с одной базой,
 *     суммирование по всем базам кластера бессмысленно.
 */
export class AdminRepository {
  /**
   * Сводка дашборда одним запросом: отчёт собирается jsonb_build_object'ом,
   * ровно в той форме, которую ожидает клиент (TS-тип описывает результат).
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
   * Динамика операций по выбранной гранулярности.
   * created_at переводим в московское время до группировки — периоды графика
   * считаются по МСК. Для metric=unique_users считаем count(distinct user_id)
   * уже на выбранной гранулярности: уникальных пользователей нельзя корректно
   * агрегировать суммированием более мелких периодов на клиенте.
   *
   * Аудитория: 'all' — все операции (и пользователей, и админов); 'users' —
   * только тех, у кого роль 'user'. Операции привязаны к создателю через
   * operations.user_id, роль берём JOIN'ом к users (JOIN inner намеренно
   * отсекает и 'admin', и удалённых авторов).
   */
  async getOperationsDynamics(
    audience: LogsAudience = 'all',
    metric: AdminChartMetric = 'count',
    aggregation: OperationsDynamicsAggregation = 'D',
  ): Promise<AdminOperationsDynamics> {
    const roleJoin =
      audience === 'users'
        ? `JOIN public.users au ON au.id = o.user_id AND au.role = 'user'`
        : '';
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

  /**
   * Динамика количества логов по МСК-часам/суткам с фильтром по аудитории и
   * метрике. Для unique_users distinct считается на выбранном бакете, поэтому
   * сервер обязан группировать сам — клиент не должен переводить часы в сутки
   * суммированием уникальных пользователей.
   *
   * Возвращаем только непустые бакеты (клиент достраивает нули на пустые
   * интервалы). Аудитория 'users' — строки с user_role = 'user': запросы
   * админов и без авторизации (NULL) отсекаются.
   */
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

  /**
   * Разбивка хранения: общий размер текущей БД + размер каждой базовой таблицы
   * схемы public (pg_total_relation_size — данные + индексы + TOAST), по
   * убыванию веса. «Остальные данные» (служебное пространство СУБД) — разница
   * databaseBytes и суммы таблиц, считает клиент.
   */
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

  /**
   * Физическое удаление пользователя: на схеме public все доменные таблицы
   * (reports, operations, categories, accumulations, goals) отваливаются каскадом
   * (on delete cascade), а request_logs.user_id обнуляется (set null). Возвращает
   * true, если строка существовала.
   */
  async deleteUser(userId: string): Promise<boolean> {
    const { rowCount } = await pool.query('DELETE FROM public.users WHERE id = $1', [userId]);
    return (rowCount ?? 0) > 0;
  }

  /**
   * Все пользователи со статистикой количества
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

  /**
   * Лёгкий список пользователей для селектов (id + email) без агрегатов и
   * JOIN'ов — только отсортированный по email обход public.users.
   */
  async listUserOptions(): Promise<AdminUserOption[]> {
    const { rows } = await pool.query<{ user_id: string; email: string }>(
      `SELECT id AS user_id, email FROM public.users ORDER BY email`,
    );
    return rows.map((row) => ({ userId: row.user_id, email: row.email }));
  }

  // ── Логи запросов (public.request_logs) ────────────────────────────────────

  /**
   * Страница логов для админки. Фильтр по статусу — whitelist из
   * LogsStatusFilter, мапится в условие status < 400 / >= 400; фильтр по
   * автору — LogsUserFilter (все / без авторизации / конкретный пользователь);
   * фильтр по методам — whitelist LogsMethod (пустой список — без фильтра).
   * Сортировка — whitelist LogsSortField/LogsSortOrder (колонка подставляется
   * из маппинга, не из строки клиента), tie-breaker id DESC для стабильной
   * пагинации при одинаковых duration_ms. Email автора тянется LEFT JOIN по
   * public.users: у строк без авторизации (user_id is null) он остаётся null.
   */
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
      user_email: string | null;
      ip: string | null;
    }>(
      `SELECT rl.id, rl.created_at, rl.method, rl.path, rl.status,
              rl.duration_ms, rl.error, rl.user_id, rl.is_authenticated,
              u.email AS user_email, host(rl.ip) AS ip
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
        userEmail: row.user_email,
        isAuthenticated: row.is_authenticated,
        ip: row.ip,
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
    const where =
      period === 'all' ? '' : `WHERE created_at >= now() - interval '${intervalMap[period]}'`;
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
