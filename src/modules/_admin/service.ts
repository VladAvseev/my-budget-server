import { consentService } from '@/modules/_consent/service.js';
import { isAnonymizedLogin, usersRepository } from '@/modules/_users/repository.js';
import { AppError } from '@/shared/appError.js';
import { requireUuid } from '@/shared/validate.js';
import { adminRepository } from './repository.js';
import type { ConsentRequestMeta } from '@/modules/_consent/types.js';
import type {
  AdminChartMetric,
  AdminDashboardStats,
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

export class AdminService {

  private static readonly CHART_METRICS: AdminChartMetric[] = ['count', 'unique_users'];
  private static readonly OPERATIONS_AGGREGATIONS: OperationsDynamicsAggregation[] = [
    'D',
    'M',
    'Y',
  ];
  private static readonly LOGS_BUCKETS: LogsDynamicsBucket[] = ['hour', 'day'];

  async getStats(): Promise<AdminDashboardStats> {
    return adminRepository.getStats();
  }

  async getOperationsDynamics(query: Record<string, unknown>): Promise<AdminOperationsDynamics> {
    return adminRepository.getOperationsDynamics(
      this.parseAudience(query.audience),
      this.parseMetric(query.metric),
      this.parseOperationsAggregation(query.aggregation),
    );
  }

  async getLogsDynamics(query: Record<string, unknown>): Promise<AdminLogsDynamics> {
    return adminRepository.getLogsDynamics(
      this.parseAudience(query.audience),
      this.parseMetric(query.metric),
      this.parseLogsBucket(query.bucket),
    );
  }

  private parseAudience(value: unknown): LogsAudience {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (raw === '' || raw === 'all') {
      return 'all';
    }
    if (raw === 'users') {
      return 'users';
    }
    throw new AppError('Недопустимый фильтр audience', 400);
  }

  private parseMetric(value: unknown): AdminChartMetric {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (raw === '' || raw === 'count') {
      return 'count';
    }
    if (AdminService.CHART_METRICS.includes(raw as AdminChartMetric)) {
      return raw as AdminChartMetric;
    }
    throw new AppError('Недопустимый фильтр metric', 400);
  }

  private parseOperationsAggregation(value: unknown): OperationsDynamicsAggregation {
    const raw = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if (raw === '') {
      return 'D';
    }
    if (AdminService.OPERATIONS_AGGREGATIONS.includes(raw as OperationsDynamicsAggregation)) {
      return raw as OperationsDynamicsAggregation;
    }
    throw new AppError('Недопустимая гранулярность aggregation', 400);
  }

  private parseLogsBucket(value: unknown): LogsDynamicsBucket {
    const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (raw === '') {
      return 'hour';
    }
    if (AdminService.LOGS_BUCKETS.includes(raw as LogsDynamicsBucket)) {
      return raw as LogsDynamicsBucket;
    }
    throw new AppError('Недопустимая гранулярность bucket', 400);
  }

  async getStorageBreakdown(): Promise<StorageBreakdown> {
    return adminRepository.getStorageBreakdown();
  }

  async deleteUser(
    currentUserId: string,
    targetUserId: unknown,
    meta: ConsentRequestMeta,
  ): Promise<void> {
    const userId = requireUuid(targetUserId);
    if (currentUserId.toLowerCase() === userId.toLowerCase()) {
      throw new AppError('Нельзя удалить собственный аккаунт', 400);
    }
    const target = await usersRepository.getById(userId);
    if (!target || isAnonymizedLogin(target.login)) {
      throw new AppError('Пользователь не найден', 404);
    }
    await consentService.revokeAndErase(userId, meta, 'admin');
  }

  async listUsers(): Promise<AdminUserRow[]> {
    return adminRepository.listUsers();
  }

  async getUserOptions(): Promise<AdminUserOption[]> {
    return adminRepository.listUserOptions();
  }

  private static readonly LOG_STATUS_FILTERS: LogsStatusFilter[] = [
    'all',
    'info',
    'warning',
    'error',
  ];
  private static readonly LOG_METHODS: LogsMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  private static readonly LOG_PERIODS: LogsPeriod[] = ['24h', '7d', '30d', 'all'];
  private static readonly LOG_SORT_FIELDS: LogsSortField[] = ['date', 'duration'];
  private static readonly LOG_SORT_ORDERS: LogsSortOrder[] = ['asc', 'desc'];

  private static readonly LOG_USER_ANONYMOUS = 'anonymous';

  async listLogs(query: Record<string, unknown>): Promise<AdminLogsPage> {
    const status = (query.status ?? 'all') as string;
    if (!AdminService.LOG_STATUS_FILTERS.includes(status as LogsStatusFilter)) {
      throw new AppError('Недопустимый фильтр status', 400);
    }

    const user = this.parseLogsUserFilter(query.userId);
    const methods = this.parseLogsMethods(query.methods);

    const sort = (query.sort ?? 'date') as string;
    if (!AdminService.LOG_SORT_FIELDS.includes(sort as LogsSortField)) {
      throw new AppError('Недопустимое поле сортировки sort', 400);
    }
    const order = (query.order ?? 'desc') as string;
    if (!AdminService.LOG_SORT_ORDERS.includes(order as LogsSortOrder)) {
      throw new AppError('Недопустимый порядок сортировки order', 400);
    }

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));

    return adminRepository.getLogs(
      status as LogsStatusFilter,
      user,
      methods,
      page,
      limit,
      sort as LogsSortField,
      order as LogsSortOrder,
    );
  }

  private parseLogsMethods(value: unknown): LogsMethod[] {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (raw === '') {
      return [];
    }
    const methods = raw
      .split(',')
      .map((part) => part.trim().toUpperCase())
      .filter((part) => part !== '');
    if (methods.some((method) => !AdminService.LOG_METHODS.includes(method as LogsMethod))) {
      throw new AppError('Недопустимый фильтр methods', 400);
    }
    return [...new Set(methods)] as LogsMethod[];
  }

  private parseLogsUserFilter(value: unknown): LogsUserFilter {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (raw === '' || raw === 'all') {
      return { kind: 'all' };
    }
    if (raw === AdminService.LOG_USER_ANONYMOUS) {
      return { kind: 'anonymous' };
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
      throw new AppError('Недопустимый фильтр userId', 400);
    }
    return { kind: 'user', userId: raw };
  }

  async getLogsMetrics(query: Record<string, unknown>): Promise<AdminLogsMetrics> {
    const period = (query.period ?? '7d') as string;
    if (!AdminService.LOG_PERIODS.includes(period as LogsPeriod)) {
      throw new AppError('Недопустимый период', 400);
    }
    return adminRepository.getLogsMetrics(period as LogsPeriod);
  }
}

export const adminService = new AdminService();
