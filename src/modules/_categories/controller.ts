import { categoriesService } from './service.js';
import type { NextFunction, Request, Response } from 'express';

export class CategoriesController {

  async list(req: Request, res: Response, next: NextFunction) {
    try {

      const type =
        typeof req.query.type === 'string' && req.query.type ? req.query.type : undefined;
      const categories = await categoriesService.list(req.user!.id, type);
      res.status(200).json({ data: categories });
    } catch (error) {
      next(error);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const category = await categoriesService.create(req.user!.id, req.body ?? {});
      res.status(201).location(`${req.originalUrl}/${category.id}`).json({ data: category });
    } catch (error) {
      next(error);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const category = await categoriesService.update(req.user!.id, req.params.id, req.body ?? {});
      res.status(200).json({ data: category });
    } catch (error) {
      next(error);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await categoriesService.remove(req.user!.id, req.params.id);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
}

export const categoriesController = new CategoriesController();
