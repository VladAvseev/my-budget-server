import { operationsService } from './service.js';
import type { NextFunction, Request, Response } from 'express';

export class OperationsController {

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const operations = await operationsService.list(req.user!.id, { ...req.query });
      res.status(200).json({ data: operations });
    } catch (error) {
      next(error);
    }
  }

  async getCategorySummary(req: Request, res: Response, next: NextFunction) {
    try {
      const summary = await operationsService.getCategorySummary(req.user!.id, { ...req.query });
      res.status(200).json({ data: summary });
    } catch (error) {
      next(error);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const operation = await operationsService.create(req.user!.id, req.body ?? {});
      res.status(201).location(`${req.originalUrl}/${operation.id}`).json({ data: operation });
    } catch (error) {
      next(error);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const operation = await operationsService.update(req.user!.id, req.params.id, req.body ?? {});
      res.status(200).json({ data: operation });
    } catch (error) {
      next(error);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await operationsService.remove(req.user!.id, req.params.id);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
}

export const operationsController = new OperationsController();
