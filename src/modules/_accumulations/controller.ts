import { accumulationsService } from './service.js';
import type { NextFunction, Request, Response } from 'express';

export class AccumulationsController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const accumulations = await accumulationsService.list(req.user!.id);
      res.status(200).json({ data: accumulations });
    } catch (error) {
      next(error);
    }
  }

  async total(req: Request, res: Response, next: NextFunction) {
    try {
      const total = await accumulationsService.getTotal(req.user!.id);
      res.status(200).json({ data: total });
    } catch (error) {
      next(error);
    }
  }

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
