import { goalsService } from './service.js';
import type { NextFunction, Request, Response } from 'express';

/**
 * HTTP-слой целей накоплений. Маршруты закрыты `authenticate` в router.ts.
 */
export class GoalsController {
  /** GET /goals → 200: список целей пользователя. */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const goals = await goalsService.list(req.user!.id);
      res.status(200).json({ data: goals });
    } catch (error) {
      next(error);
    }
  }

  /** POST /goals — body: { categoryId, amount, targetDate? } → 201/400/409. */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const goal = await goalsService.create(req.user!.id, req.body ?? {});
      res.status(201).location(`${req.originalUrl}/${goal.id}`).json({ data: goal });
    } catch (error) {
      next(error);
    }
  }

  /** PATCH /goals/:id — body: { amount?, targetDate? } → 200: обновлённая цель. */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const goal = await goalsService.update(req.user!.id, req.params.id, req.body ?? {});
      res.status(200).json({ data: goal });
    } catch (error) {
      next(error);
    }
  }

  /** DELETE /goals/:id → 204/404. */
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
