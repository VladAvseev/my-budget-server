import type { NextFunction, Request, Response } from 'express';
import { healthService } from './service.js';

export class HealthController {
  async getHealth(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await healthService.getStatus();
      res.status(result.status === 'ok' ? 200 : 503).json({ data: result });
    } catch (error) {
      next(error);
    }
  }
}
export const healthController = new HealthController();
