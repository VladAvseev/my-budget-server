import { goalsService } from './service.js';
import type { NextFunction, Request, Response } from 'express';

export class GoalsController {

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const goals = await goalsService.list(req.user!.id);
      res.status(200).json({ data: goals });
    } catch (error) {
      next(error);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const goal = await goalsService.create(req.user!.id, req.body ?? {});
      res.status(201).location(`${req.originalUrl}/${goal.id}`).json({ data: goal });
    } catch (error) {
      next(error);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const goal = await goalsService.update(req.user!.id, req.params.id, req.body ?? {});
      res.status(200).json({ data: goal });
    } catch (error) {
      next(error);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await goalsService.remove(req.user!.id, req.params.id);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
}

export const goalsController = new GoalsController();
