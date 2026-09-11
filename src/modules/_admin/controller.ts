import { adminService } from './service.js';
import type { NextFunction, Request, Response } from 'express';

/**
 * HTTP-слой админ-панели. Все маршруты закрыты authenticate + requireAdmin
 * в router.ts: req.user здесь гарантированно заполнен и содержит role === 'admin'.
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

  /**
   * GET /admin/dashboard/operations-dynamics?audience=&metric=&aggregation=
   * → 200: { audience, metric, aggregation, points[], total }.
   */
  async getOperationsDynamics(req: Request, res: Response, next: NextFunction) {
    try {
      const dynamics = await adminService.getOperationsDynamics(req.query as Record<string, unknown>);
      res.status(200).json({ data: dynamics });
    } catch (error) {
      next(error);
    }
  }

  /** GET /admin/dashboard/storage-breakdown → 200: { databaseBytes, tables[] }. */
  async getStorageBreakdown(_req: Request, res: Response, next: NextFunction) {
    try {
      const breakdown = await adminService.getStorageBreakdown();
      res.status(200).json({ data: breakdown });
    } catch (error) {
      next(error);
    }
  }

  /** DELETE /admin/users/:userId → 204: удаление пользователя со всеми данными. */
  async deleteUser(req: Request, res: Response, next: NextFunction) {
    try {
      await adminService.deleteUser(req.user!.id, req.params.userId);
      res.status(204).end();
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

  /** GET /admin/users/options → 200: [{ userId, email }] для селектов. */
  async getUserOptions(_req: Request, res: Response, next: NextFunction) {
    try {
      const options = await adminService.getUserOptions();
      res.status(200).json({ data: options });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /admin/logs?status=&userId=&page=&limit=&sort=date|duration&order=asc|desc
   * → 200: страница логов запросов.
   */
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

  /**
   * GET /admin/logs/dynamics?audience=&metric=&bucket=
   * → 200: { audience, metric, bucket, points[], total }.
   */
  async getLogsDynamics(req: Request, res: Response, next: NextFunction) {
    try {
      const dynamics = await adminService.getLogsDynamics(req.query as Record<string, unknown>);
      res.status(200).json({ data: dynamics });
    } catch (error) {
      next(error);
    }
  }
}

export const adminController = new AdminController();
