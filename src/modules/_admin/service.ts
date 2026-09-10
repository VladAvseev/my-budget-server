import { AppError } from '@/shared/appError.js';
import { requireUuid } from '@/shared/validate.js';
import { adminRepository } from './repository.js';
import type {
  AdminDashboardStats,
  AdminDynamicsRow,
  AdminLogsMetrics,
  AdminLogsPage,
  AdminUserRow,
  DatabaseSize,
  LogsPeriod,
  LogsSortField,
  LogsSortOrder,
  LogsStatusFilter,
  LogsUserFilter,
  StorageBreakdown,
} from './types.js';

/**
 * Бизнес-логика админ-панели — тонкий слой над портированными запросами.
 *
 * Единственная «логика» прежних RPC — проверка is_admin() с
 * raise 'Доступ запрещён'; на сервере её целиком закрывает middleware
 * requireAdmin (роль берётся из JWT-claims, которые подписывает _auth).
 * Поэтому сервис только пробрасывает данные — но остаётся точкой, куда
 * ляжет будущая логика (например, агрегация или кэш тяжёлых счётчиков).
 */
export class AdminService {
  async getStats(): Promise<AdminDashboardStats> {
    return adminRepository.getStats();
  }

  async getOperationsDynamics(): Promise<AdminDynamicsRow[]> {
    return adminRepository.getOperationsDynamics();
  }

  async getDatabaseSize(): Promise<DatabaseSize> {
    return adminRepository.getDatabaseSize();
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

  // ── Логи запросов ─────────────────────────────────────────────────────────

  /** Белые списки значений фильтров — вне списка бросаем 400. */
  private static readonly LOG_STATUS_FILTERS: LogsStatusFilter[] = ['all', 'success', 'error'];
  private static readonly LOG_PERIODS: LogsPeriod[] = ['24h', '7d', '30d', 'all'];
  private static readonly LOG_SORT_FIELDS: LogsSortField[] = ['date', 'duration'];
  private static readonly LOG_SORT_ORDERS: LogsSortOrder[] = ['asc', 'desc'];

  /** Значение userId = «только запросы без авторизации» (остальное — uuid пользователя). */
  private static readonly LOG_USER_ANONYMOUS = 'anonymous';

  /**
   * GET /admin/logs — query: status=all|success|error, userId=<uuid>|anonymous,
   * page, limit, sort=date|duration, order=asc|desc.
   */
  async listLogs(query: Record<string, unknown>): Promise<AdminLogsPage> {
    const status = (query.status ?? 'all') as string;
    if (!AdminService.LOG_STATUS_FILTERS.includes(status as LogsStatusFilter)) {
      throw new AppError('Недопустимый фильтр status', 400);
    }

    const user = this.parseLogsUserFilter(query.userId);

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
      page,
      limit,
      sort as LogsSortField,
      order as LogsSortOrder,
    );
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
