/**
 * Типы модуля admin: сводки дашборда, динамика операций, размер БД,
 * список пользователей, логи запросов.
 * Ключи соответствуют типам клиента, которые живут в файлах его хуков:
 * AdminDashboardStats — client/src/modules/_admin/_dashboard/api/useAdminStats.ts,
 * AdminUserRow — client/src/modules/_admin/_users/api/useAdminUsers.ts,
 * форма строк логов — client/src/modules/_admin/_logs/api/useAdminLogs.ts
 * (DatabaseSize клиентом не используется: карточка «Хранилище» берёт
 * storage-breakdown), чтобы админ-панель не менялась.
 *
 * Права: доступ к маршрутам даёт middleware requireAdmin
 * (authenticate + JWT-claim role) в router.ts.
 */

/** Ответ GET /admin/dashboard/stats — структура admin_get_dashboard_stats. */
export interface AdminDashboardStats {
  users: {
    total: number;
    /** Пользователи без единого отчёта — «не начали пользоваться». */
    withoutReports: number;
    onboarded: number;
  };
  /** Активные по окну активности (DAU…YAU) — счётчики last_active_at. */
  activity: {
    dau: number;
    wau: number;
    mau: number;
    qau: number;
    sau: number;
    yau: number;
  };
  /** Отток: неактивнее окна (последний из двух — всего, сколько «спят» дольше). */
  churn: {
    inactive1d: number;
    inactive7d: number;
    inactive30d: number;
    inactive90d: number;
    inactive180d: number;
    inactive365d: number;
  };
  reports: {
    total: number;
    withDailyExpenses: number;
  };
  operations: {
    total: number;
    income: number;
    expense: number;
    daily: number;
    /** savings и savings_out считаются вместе. */
    savings: number;
  };
}

/** Метрика графиков: количество записей или уникальные авторы. */
export type AdminChartMetric = 'count' | 'unique_users';

/** Гранулярность графика динамики операций: день, месяц или год. */
export type OperationsDynamicsAggregation = 'D' | 'M' | 'Y';

/** Гранулярность графика динамики логов: МСК-час или МСК-сутки. */
export type LogsDynamicsBucket = 'hour' | 'day';

/** Одна точка графика: ключ периода (зависит от гранулярности) и значение метрики. */
export interface AdminChartPoint {
  period: string;
  value: number;
}

/** Ответ GET /admin/dashboard/operations-dynamics. */
export interface AdminOperationsDynamics {
  audience: LogsAudience;
  metric: AdminChartMetric;
  aggregation: OperationsDynamicsAggregation;
  points: AdminChartPoint[];
  total: number;
}

/** Ответ GET /admin/dashboard/database-size (admin_get_database_size). */
export interface DatabaseSize {
  sizeBytes: number;
  sizePretty: string;
}

/** Размер одной таблицы БД, байты (pg_total_relation_size: данные + индексы + TOAST). */
export interface TableStorageSize {
  name: string;
  sizeBytes: number;
}

/**
 * Ответ GET /admin/dashboard/storage-breakdown: общий размер текущей БД
 * (pg_database_size) и разбивка по всем базовым таблицам схемы public.
 * Долю «остальных данных» (служебное пространство СУБД) клиент считает сам
 * как databaseBytes минус сумма размеров таблиц.
 */
export interface StorageBreakdown {
  databaseBytes: number;
  tables: TableStorageSize[];
}

/**
 * Строка таблицы пользователей админки. Ключи смешанные
 * (user_id/last_active_at в snake_case, счётчики в camelCase) — их ожидает
 * клиентский AdminUserRow.
 */
export interface AdminUserRow {
  user_id: string;
  email: string;
  last_active_at: string | null;
  onboarded: boolean;
  reportsCount: number;
  operationsCount: number;
  categoriesCount: number;
  incomeCount: number;
  dailyCount: number;
  expenseCount: number;
  savingsCount: number;
  accumulationsCount: number;
  goalsCount: number;
}

// ── Логи запросов (таблица public.request_logs) ─────────────────────────────

/** Фильтр списка логов: все / только успешные (<400) / только с ошибкой (≥400). */
export type LogsStatusFilter = 'all' | 'success' | 'error';

/** Допустимые значения фильтра methods в GET /admin/logs (пустой список — все). */
export type LogsMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Фильтр логов по автору (query `userId` в GET /admin/logs):
 *   * all       — без фильтра;
 *   * anonymous — только запросы без авторизации (is_authenticated = false);
 *   * user      — запросы конкретного пользователя.
 */
export type LogsUserFilter =
  { kind: 'all' } | { kind: 'anonymous' } | { kind: 'user'; userId: string };

/** Период агрегации метрик. */
export type LogsPeriod = '24h' | '7d' | '30d' | 'all';

/**
 * Фильтр по роли автора (query `audience` в эндпоинтах графиков):
 *   * all   — без фильтра (операции/логи и пользователей, и админов);
 *   * users — только роль 'user' (без админов и без запросов без авторизации).
 */
export type LogsAudience = 'all' | 'users';

/**
 * Ответ GET /admin/logs/dynamics: точки выбранной гранулярности и общий итог.
 * Для metric=count total — все логи, для unique_users — уникальные user_id за
 * всё время (не сумма почасовых/суточных уникальных пользователей).
 */
export interface AdminLogsDynamics {
  audience: LogsAudience;
  metric: AdminChartMetric;
  bucket: LogsDynamicsBucket;
  points: AdminChartPoint[];
  total: number;
}

/**
 * Сортировка строк логов (query `sort`/`order` в GET /admin/logs):
 * date — created_at (по умолчанию), duration — duration_ms.
 */
export type LogsSortField = 'date' | 'duration';
export type LogsSortOrder = 'asc' | 'desc';

/** Одна строка лога (GET /admin/logs). */
export interface AdminLogRow {
  id: number;
  createdAt: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  /** Текст ошибки для ответов с статусом >= 400; null — запрос успешный. */
  error: string | null;
  /** Автор запроса; null — запрос без авторизации (или пользователь удалён). */
  userId: string | null;
  /** Email автора (JOIN users) для отображения в админке; null, если неавторизован. */
  userEmail: string | null;
  /** true — на момент запроса был валидный access-токен (см. is_authenticated). */
  isAuthenticated: boolean;
  ip: string | null;
}

/** Ответ GET /admin/logs — страница + пагинация. */
export interface AdminLogsPage {
  items: AdminLogRow[];
  total: number;
  page: number;
  limit: number;
}

/** Эндпоинт со статистикой (топ-листы метрик). */
export interface AdminLogEndpointStat {
  endpoint: string; // 'GET /reports'
  count: number;
  avgDurationMs: number;
  errorCount: number;
}

/** Динамика по дню (или по часу при period=24h). */
export interface AdminLogsSeriesPoint {
  point: string; // 'YYYY-MM-DD' или ISO-час
  total: number;
  errors: number;
}

/** Ответ GET /admin/logs/metrics. */
export interface AdminLogsMetrics {
  period: LogsPeriod;
  total: number;
  successCount: number;
  errorCount: number;
  /** Доля ошибок 0..1 (null, если запросов не было). */
  errorRate: number | null;
  avgDurationMs: number | null;
  p95DurationMs: number | null;
  topSlowestEndpoints: AdminLogEndpointStat[];
  topErrorEndpoints: AdminLogEndpointStat[];
  perPoint: AdminLogsSeriesPoint[];
}
