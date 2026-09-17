import { adminService } from './service.js';
import type { NextFunction, Request, Response } from 'express';

export class AdminController {

  async getStats(_req: Request, res: Response, next: NextFunction) {
    try {
      const stats = await adminService.getStats();
      res.status(200).json({ data: stats });
    } catch (error) {
      next(error);
    }
  }

  async getOperationsDynamics(req: Request, res: Response, next: NextFunction) {
    try {
      const dynamics = await adminService.getOperationsDynamics(
        req.query as Record<string, unknown>,
      );
      res.status(200).json({ data: dynamics });
    } catch (error) {
      next(error);
    }
  }

  async getStorageBreakdown(_req: Request, res: Response, next: NextFunction) {
    try {
      const breakdown = await adminService.getStorageBreakdown();
      res.status(200).json({ data: breakdown });
    } catch (error) {
      next(error);
    }
  }

  async deleteUser(req: Request, res: Response, next: NextFunction) {
    try {
      await adminService.deleteUser(req.user!.id, req.params.userId, {
        ip: req.ip ?? 'unknown',
        userAgent: req.headers['user-agent'] ?? null,
      });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }

  async listUsers(_req: Request, res: Response, next: NextFunction) {
    try {
      const users = await adminService.listUsers();
      res.status(200).json({ data: users });
    } catch (error) {
      next(error);
    }
  }

  async getUserOptions(_req: Request, res: Response, next: NextFunction) {
    try {
      const options = await adminService.getUserOptions();
      res.status(200).json({ data: options });
    } catch (error) {
      next(error);
    }
  }

  async listLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const logs = await adminService.listLogs(req.query as Record<string, unknown>);
      res.status(200).json({ data: logs });
    } catch (error) {
      next(error);
    }
  }

  async getLogsMetrics(req: Request, res: Response, next: NextFunction) {
    try {
      const metrics = await adminService.getLogsMetrics(req.query as Record<string, unknown>);
      res.status(200).json({ data: metrics });
    } catch (error) {
      next(error);
    }
  }

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
