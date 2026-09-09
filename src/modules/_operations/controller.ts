import { operationsService } from './service.js';
import type { NextFunction, Request, Response } from 'express';

/**
 * HTTP-слой операций. Маршруты закрыты `authenticate` в router.ts —
 * id пользователя берётся из проверенного JWT (req.user.id), это замена
 * auth.uid() внутри RPC-функций Supabase.
 */
export class OperationsController {
  /**
   * GET /operations?reportId={id}&type={type} — операции отчёта по типу;
   * GET /operations?reportIds={id1,id2,...} — сводка по набору отчётов.
   */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const operations = await operationsService.list(req.user!.id, { ...req.query });
      res.status(200).json({ data: operations });
    } catch (error) {
      next(error);
    }
  }

  /** GET /operations/savings → 200: все savings/savings_out с данными отчёта. */
  async getSavings(req: Request, res: Response, next: NextFunction) {
    try {
      const operations = await operationsService.listSavings(req.user!.id);
      res.status(200).json({ data: operations });
    } catch (error) {
      next(error);
    }
  }

  /** POST /operations — body: { reportId, type, amount, categoryId?, description?, date? } → 201. */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const operation = await operationsService.create(req.user!.id, req.body ?? {});
      res.status(201).location(`${req.originalUrl}/${operation.id}`).json({ data: operation });
    } catch (error) {
      next(error);
    }
  }

  /** PATCH /operations/:id → 200: обновлённая операция. */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const operation = await operationsService.update(req.user!.id, req.params.id, req.body ?? {});
      res.status(200).json({ data: operation });
    } catch (error) {
      next(error);
    }
  }

  /** DELETE /operations/:id → 204/404. */
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
