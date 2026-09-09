import type { NextFunction, Request, Response } from 'express';

export class CategoriesController {
  list(req: Request, res: Response, next: NextFunction) {
    // TODO: реализовать в service.ts
    res.status(200).json({ data: [] });
  }

  create(req: Request, res: Response, next: NextFunction) {
    // TODO: реализовать в service.ts
    res.status(201).json({ data: null });
  }

  update(req: Request, res: Response, next: NextFunction) {
    // TODO: реализовать в service.ts
    res.status(200).json({ data: null });
  }

  remove(req: Request, res: Response, next: NextFunction) {
    // TODO: реализовать в service.ts
    res.status(204).end();
  }
}

export const categoriesController = new CategoriesController();
