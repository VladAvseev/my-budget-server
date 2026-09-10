import { adminService } from './service.js';
import type { NextFunction, Request, Response } from 'express';

/**
 * HTTP-слой админ-панели. Все маршруты закрыты authenticate + requireAdmin
 * в router.ts (замена is_admin() из RPC Supabase); req.user здесь гарантированно
 * заполнен и содержит role === 'admin'.
 */
export class AdminController {
  /** GET /admin/dashboard/stats → 200: сводка дашборда (AdminDashboardStats). */
  async getStats(_req: Request, res: Response, next: NextFunction) {
    try {
      const stats = await adminService.getStats();
      res.status(200).json({ data: stats });
    } catch (error) {
      next(error);
    }
  }

  /** GET /admin/dashboard/operations-dynamics → 200: [{ day, operations_count }]. */
  async getOperationsDynamics(_req: Request, res: Response, next: NextFunction) {
    try {
      const dynamics = await adminService.getOperationsDynamics();
      res.status(200).json({ data: dynamics });
    } catch (error) {
      next(error);
    }
  }

  /** GET /admin/dashboard/database-size → 200: { sizeBytes, sizePretty }. */
  async getDatabaseSize(_req: Request, res: Response, next: NextFunction) {
    try {
      const size = await adminService.getDatabaseSize();
      res.status(200).json({ data: size });
    } catch (error) {
      next(error);
    }
  }

  /** GET /admin/users → 200: список пользователей со статистикой. */
  async listUsers(_req: Request, res: Response, next: NextFunction) {
    try {
      const users = await adminService.listUsers();
      res.status(200).json({ data: users });
    } catch (error) {
      next(error);
    }
  }

  /** GET /admin/logs?status=&page=&limit= → 200: страница логов запросов. */
  async listLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const logs = await adminService.listLogs(req.query as Record<string, unknown>);
      res.status(200).json({ data: logs });
    } catch (error) {
      next(error);
    }
  }

  /** GET /admin/logs/metrics?period= → 200: агрегированные метрики логов. */
  async getLogsMetrics(req: Request, res: Response, next: NextFunction) {
    try {
      const metrics = await adminService.getLogsMetrics(req.query as Record<string, unknown>);
      res.status(200).json({ data: metrics });
    } catch (error) {
      next(error);
    }
  }
}

export const adminController = new AdminController();
