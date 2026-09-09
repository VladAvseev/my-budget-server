import type { NextFunction, Request, Response } from 'express';

export class ReportsController {
  list(req: Request, res: Response, next: NextFunction) {
    // TODO: реализовать в service.ts
    res.status(200).json({ data: [] });
  }

  create(req: Request, res: Response, next: NextFunction) {
    // TODO: реализовать в service.ts
    res.status(201).json({ data: null });
  }

  getById(req: Request, res: Response, next: NextFunction) {
    // TODO: реализовать в service.ts
    res.status(200).json({ data: null });
  }

  update(req: Request, res: Response, next: NextFunction) {
    // TODO: реализовать в service.ts
    res.status(200).json({ data: null });
  }

  remove(req: Request, res: Response, next: NextFunction) {
    // TODO: реализовать в service.ts
    res.status(204).end();
  }

  getSummary(req: Request, res: Response, next: NextFunction) {
    // TODO: реализовать в service.ts
    res.status(200).json({ data: null });
  }

  getCategoryLimits(req: Request, res: Response, next: NextFunction) {
    // TODO: реализовать в service.ts
    res.status(200).json({ data: [] });
  }

  setCategoryLimits(req: Request, res: Response, next: NextFunction) {
    // TODO: реализовать в service.ts
    res.status(200).json({ data: [] });
  }

  createDailyExpense(req: Request, res: Response, next: NextFunction) {
    // TODO: реализовать в service.ts
    res.status(201).json({ data: null });
  }

  disableDailyExpenses(req: Request, res: Response, next: NextFunction) {
    // TODO: реализовать в service.ts
    res.status(204).end();
  }
}

export const reportsController = new ReportsController();
