import { accumulationsService } from './service.js';
import type { NextFunction, Request, Response } from 'express';

/**
 * HTTP-слой накоплений. Маршруты закрыты `authenticate` в router.ts —
 * доступ к чужим строкам отсекает фильтр user_id в репозитории.
 */
export class AccumulationsController {
  /** GET /accumulations → 200: список накоплений (новые сверху). */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const accumulations = await accumulationsService.list(req.user!.id);
      res.status(200).json({ data: accumulations });
    } catch (error) {
      next(error);
    }
  }

  /** POST /accumulations — body: { amount, description, categoryId? } → 201 + Location. */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const accumulation = await accumulationsService.create(req.user!.id, req.body ?? {});
      res
        .status(201)
        .location(`${req.originalUrl}/${accumulation.id}`)
        .json({ data: accumulation });
    } catch (error) {
      next(error);
    }
  }

  /** PATCH /accumulations/:id → 200: обновлённое накопление. */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const accumulation = await accumulationsService.update(
        req.user!.id,
        req.params.id,
        req.body ?? {},
      );
      res.status(200).json({ data: accumulation });
    } catch (error) {
      next(error);
    }
  }

  /** DELETE /accumulations/:id → 204/404. */
  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await accumulationsService.remove(req.user!.id, req.params.id);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
}

export const accumulationsController = new AccumulationsController();
