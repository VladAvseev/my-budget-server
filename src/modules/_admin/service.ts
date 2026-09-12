import { AppError } from '@/shared/appError.js';
import { requireUuid } from '@/shared/validate.js';
import { adminRepository } from './repository.js';
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

/**
 * Бизнес-логика админ-панели — тонкий слой над запросами репозитория.
 *
 * Права целиком закрывает middleware requireAdmin (роль берётся из JWT-claims,
 * которые подписывает _auth), поэтому сервис только пробрасывает данные —
 * но остаётся точкой, куда ляжет будущая логика (например, агрегация или
 * кэш тяжёлых счётчиков).
 */
export class AdminService {
  /** Белые списки параметров графиков — вне списка бросаем 400. */
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

  /**
   * GET /admin/dashboard/operations-dynamics — query:
   * audience=all|users, metric=count|unique_users, aggregation=D|M|Y.
   */
  async getOperationsDynamics(query: Record<string, unknown>): Promise<AdminOperationsDynamics> {
    return adminRepository.getOperationsDynamics(
      this.parseAudience(query.audience),
      this.parseMetric(query.metric),
      this.parseOperationsAggregation(query.aggregation),
    );
  }

  /**
   * GET /admin/logs/dynamics — query:
   * audience=all|users, metric=count|unique_users, bucket=hour|day.
   */
  async getLogsDynamics(query: Record<string, unknown>): Promise<AdminLogsDynamics> {
    return adminRepository.getLogsDynamics(
      this.parseAudience(query.audience),
      this.parseMetric(query.metric),
      this.parseLogsBucket(query.bucket),
    );
  }

  /**
   * Разбор фильтра аудитории по роли: пусто/all — без фильтра, users — только
   * роль 'user'. Мусорное значение = 400 (в репозиторий уходит только 'all'|'users').
   */
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

  /** Метрика графика: пусто/count — количество, unique_users — count(distinct user_id). */
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

  /** Гранулярность операций: пусто/D — день, M — месяц, Y — год. */
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

  /** Гранулярность логов: пусто/hour — МСК-час, day — МСК-сутки. */
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

  /**
   * Удаление пользователя администратором. Своё удаление запрещено (400), чтобы
   * админ не остался без доступа к панели; несуществующий id → 404. Все данные
   * пользователя серверная БД снимает каскадом.
   */
  async deleteUser(currentUserId: string, targetUserId: unknown): Promise<void> {
    const userId = requireUuid(targetUserId);
    if (currentUserId.toLowerCase() === userId.toLowerCase()) {
      throw new AppError('Нельзя удалить собственный аккаунт', 400);
    }
    const deleted = await adminRepository.deleteUser(userId);
    if (!deleted) {
      throw new AppError('Пользователь не найден', 404);
    }
  }

  async listUsers(): Promise<AdminUserRow[]> {
    return adminRepository.listUsers();
  }

  /** GET /admin/users/options — лёгкие id+login для селектов (без агрегатов). */
  async getUserOptions(): Promise<AdminUserOption[]> {
    return adminRepository.listUserOptions();
  }

  // ── Логи запросов ─────────────────────────────────────────────────────────

  /** Белые списки значений фильтров — вне списка бросаем 400. */
  private static readonly LOG_STATUS_FILTERS: LogsStatusFilter[] = ['all', 'success', 'error'];
  private static readonly LOG_METHODS: LogsMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  private static readonly LOG_PERIODS: LogsPeriod[] = ['24h', '7d', '30d', 'all'];
  private static readonly LOG_SORT_FIELDS: LogsSortField[] = ['date', 'duration'];
  private static readonly LOG_SORT_ORDERS: LogsSortOrder[] = ['asc', 'desc'];

  /** Значение userId = «только запросы без авторизации» (остальное — uuid пользователя). */
  private static readonly LOG_USER_ANONYMOUS = 'anonymous';

  /**
   * GET /admin/logs — query: status=all|success|error, userId=<uuid>|anonymous,
   * methods=GET,POST (пусто — все методы), page, limit, sort=date|duration,
   * order=asc|desc.
   */
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

  /**
   * Разбор фильтра по HTTP-методам: query `methods=GET,POST` (регистр не
   * важен). Пусто — без фильтра; значение вне белого списка = 400.
   */
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

  /**
   * Разбор фильтра по автору: пусто/all — без фильтра, 'anonymous' — запросы
   * без авторизации, иначе — uuid пользователя. Мусорный uuid = 400, чтобы в
   * репозиторий не уходило значение, которое никогда ничего не найдёт.
   */
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

  /** GET /admin/logs/metrics — query: period=24h|7d|30d|all (по умолчанию 7d). */
  async getLogsMetrics(query: Record<string, unknown>): Promise<AdminLogsMetrics> {
    const period = (query.period ?? '7d') as string;
    if (!AdminService.LOG_PERIODS.includes(period as LogsPeriod)) {
      throw new AppError('Недопустимый период', 400);
    }
    return adminRepository.getLogsMetrics(period as LogsPeriod);
  }
}

export const adminService = new AdminService();
