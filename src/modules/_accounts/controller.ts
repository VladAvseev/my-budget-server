import type { NextFunction, Request, Response } from 'express';
import { accountsService } from './service.js';

export class AccountsController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      res.status(200).json({ data: await accountsService.list(req.user!.id, req.query.is_closed) });
    } catch (error) {
      next(error);
    }
  }
  async get(req: Request, res: Response, next: NextFunction) {
    try {
      res.status(200).json({ data: await accountsService.get(req.user!.id, req.params.id) });
    } catch (error) {
      next(error);
    }
  }
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await accountsService.create(req.user!.id, req.body ?? {});
      res.status(201).location(`${req.baseUrl}/${data.id}`).json({ data });
    } catch (error) {
      next(error);
    }
  }
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      res
        .status(200)
        .json({ data: await accountsService.update(req.user!.id, req.params.id, req.body ?? {}) });
    } catch (error) {
      next(error);
    }
  }
  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await accountsService.remove(req.user!.id, req.params.id);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
}
export const accountsController = new AccountsController();
