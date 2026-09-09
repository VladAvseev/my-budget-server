/**
 * Типы модуля admin — порт RPC admin_get_dashboard_stats /
 * admin_get_operations_dynamics / admin_get_database_size / admin_get_users
 * (см. client/src/modules/_admin/**).
 * Ключи соответствуют доменным типам клиента (AdminDashboardStats,
 * AdminUserRow, DatabaseSize из client/src/shared/supabase/types/domain.ts),
 * чтобы админ-панель при миграции не менялась.
 *
 * Права: в Supabase каждую RPC-функцию охраняла проверка is_admin()
 * (raise exception 'Доступ запрещён'); на сервере её выполняет middleware
 * requireAdmin (authenticate + JWT-claim role) в router.ts.
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
    /** savings и savings_out считаются вместе — как в RPC. */
    savings: number;
  };
}

/** Одна точка графика динамики (admin_get_operations_dynamics). */
export interface AdminDynamicsRow {
  /** Ключ day/operations_count — имена колонок returns-table RPC. */
  day: string;
  operations_count: number;
}

/** Ответ GET /admin/dashboard/database-size (admin_get_database_size). */
export interface DatabaseSize {
  sizeBytes: number;
  sizePretty: string;
}

/**
 * Строка таблицы пользователей админки (admin_get_users). Ключи смешанные
 * (user_id/last_active_at в snake_case, счётчики в camelCase) — оставлены
 * как в jsonb исторического RPC: клиентский AdminUserRow такой же.
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
