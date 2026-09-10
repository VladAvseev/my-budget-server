/**
 * Типы модуля admin: сводки дашборда, динамика операций, размер БД,
 * список пользователей, логи запросов.
 * Ключи соответствуют доменным типам клиента (AdminDashboardStats,
 * AdminUserRow, DatabaseSize в client/src/shared/api/types/domain.ts),
 * чтобы админ-панель не менялась.
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

/** Одна точка графика динамики (admin_get_operations_dynamics). */
export interface AdminDynamicsRow {
  /** Ключ day/operations_count — имена колонок запроса, возвращающего таблицу. */
  day: string;
  operations_count: number;
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
 * Одна точка графика динамики логов: бакет — МСК-час (самая мелкая гранулярность;
 * «День» клиент агрегирует из часов сам, отдельного запроса не нужно).
 */
export interface AdminLogsDynamicsPoint {
  /** Начало МСК-часа как 'YYYY-MM-DDTHH:00:00' (wall-clock Москвы, без смещения). */
  hour: string;
  count: number;
}

/** Ответ GET /admin/logs/dynamics. */
export interface AdminLogsDynamics {
  audience: LogsAudience;
  points: AdminLogsDynamicsPoint[];
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
