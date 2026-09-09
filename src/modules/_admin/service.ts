import { adminRepository } from './repository.js';
import type { AdminDashboardStats, AdminDynamicsRow, AdminUserRow, DatabaseSize } from './types.js';

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
}

export const adminService = new AdminService();
