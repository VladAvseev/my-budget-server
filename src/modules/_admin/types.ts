export interface AdminDashboardStats {
  users: {
    total: number;

    onboarded: number;
  };

  activity: {
    dau: number;
    wau: number;
    mau: number;
    qau: number;
    sau: number;
    yau: number;
  };

  churn: {
    inactive1d: number;
    inactive7d: number;
    inactive30d: number;
    inactive90d: number;
    inactive180d: number;
    inactive365d: number;
  };
  operations: {
    total: number;
    income: number;
    expense: number;

    transfer: number;
  };
}

export type AdminChartMetric = 'count' | 'unique_users';

export type OperationsDynamicsAggregation = 'D' | 'M' | 'Y';

export type LogsDynamicsBucket = 'hour' | 'day';

export interface AdminChartPoint {
  period: string;
  value: number;
}

export interface AdminOperationsDynamics {
  audience: LogsAudience;
  metric: AdminChartMetric;
  aggregation: OperationsDynamicsAggregation;
  points: AdminChartPoint[];
  total: number;
}

export interface TableStorageSize {
  name: string;
  sizeBytes: number;
}

export interface StorageBreakdown {
  databaseBytes: number;
  tables: TableStorageSize[];
}

export interface AdminUserRow {
  user_id: string;
  login: string;
  last_active_at: string | null;
  onboarded: boolean;
  operationsCount: number;
  categoriesCount: number;
  incomeCount: number;
  expenseCount: number;
  transferCount: number;

  accountsCount: number;

  goalsCount: number;
}

export interface AdminUserOption {
  userId: string;
  login: string;
}

export type LogsStatusFilter = 'all' | 'info' | 'warning' | 'error';

export type LogsMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type LogsUserFilter =
  { kind: 'all' } | { kind: 'anonymous' } | { kind: 'user'; userId: string };

export type LogsPeriod = '24h' | '7d' | '30d' | 'all';

export type LogsAudience = 'all' | 'users';

export interface AdminLogsDynamics {
  audience: LogsAudience;
  metric: AdminChartMetric;
  bucket: LogsDynamicsBucket;
  points: AdminChartPoint[];
  total: number;
}

export type LogsSortField = 'date' | 'duration';
export type LogsSortOrder = 'asc' | 'desc';

export interface AdminLogRow {
  id: number;
  createdAt: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;

  error: string | null;

  userId: string | null;

  userLogin: string | null;

  isAuthenticated: boolean;
}

export interface AdminLogsPage {
  items: AdminLogRow[];
  total: number;
  page: number;
  limit: number;
}

export interface AdminLogEndpointStat {
  endpoint: string;
  count: number;
  avgDurationMs: number;
  errorCount: number;
}

export interface AdminLogsMetrics {
  period: LogsPeriod;
  total: number;
  infoCount: number;
  warningCount: number;
  errorCount: number;

  errorRate: number | null;
  avgDurationMs: number | null;
  p95DurationMs: number | null;
  topSlowestEndpoints: AdminLogEndpointStat[];
  topErrorEndpoints: AdminLogEndpointStat[];
}
