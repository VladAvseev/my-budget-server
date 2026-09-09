import type { NextFunction, Request, Response } from 'express';

export class AdminController {
  getStats(req: Request, res: Response, next: NextFunction) {
    // TODO: реализовать в service.ts
    res.status(200).json({ data: null });
  }

  getOperationsDynamics(req: Request, res: Response, next: NextFunction) {
    // TODO: реализовать в service.ts
    res.status(200).json({ data: [] });
  }

  getDatabaseSize(req: Request, res: Response, next: NextFunction) {
    // TODO: реализовать в service.ts
    res.status(200).json({ data: null });
  }

  listUsers(req: Request, res: Response, next: NextFunction) {
    // TODO: реализовать в service.ts
    res.status(200).json({ data: [] });
  }
}

export const adminController = new AdminController();
