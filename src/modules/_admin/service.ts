import { AppError } from '@/shared/appError.js';
import { requireUuid } from '@/shared/validate.js';
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

  /**
   * DELETE /admin/users/:id — безвозвратное удаление аккаунта со всей
   * статистикой (каскад в db/schema.sql снимает reports/operations/
   * categories/accumulations/goals/category_limits/refresh_tokens).
   * Защита: админ не может удалить собственный аккаунт (400).
   */
  async removeUser(id: unknown, currentAdminId: string): Promise<void> {
    const userId = requireUuid(id);
    if (userId === currentAdminId) {
      throw new AppError('Нельзя удалить собственный аккаунт', 400);
    }
    const removed = await adminRepository.removeUser(userId);
    if (!removed) {
      throw new AppError('Пользователь не найден', 404);
    }
  }
}

export const adminService = new AdminService();
