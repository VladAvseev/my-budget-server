import { AppError } from '@/shared/appError.js';
import { adminRepository } from './repository.js';
import type {
  AdminDashboardStats,
  AdminDynamicsRow,
  AdminLogsMetrics,
  AdminLogsPage,
  AdminUserRow,
  DatabaseSize,
  LogsPeriod,
  LogsStatusFilter,
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

  async listUsers(): Promise<AdminUserRow[]> {
    return adminRepository.listUsers();
  }

  // ── Логи запросов ─────────────────────────────────────────────────────────

  /** Белые списки значений фильтров — вне списка бросаем 400. */
  private static readonly LOG_STATUS_FILTERS: LogsStatusFilter[] = ['all', 'success', 'error'];
  private static readonly LOG_PERIODS: LogsPeriod[] = ['24h', '7d', '30d', 'all'];

  /** GET /admin/logs — query: status=all|success|error, page, limit. */
  async listLogs(query: Record<string, unknown>): Promise<AdminLogsPage> {
    const status = (query.status ?? 'all') as string;
    if (!AdminService.LOG_STATUS_FILTERS.includes(status as LogsStatusFilter)) {
      throw new AppError('Недопустимый фильтр status', 400);
    }

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));

    return adminRepository.getLogs(status as LogsStatusFilter, page, limit);
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
