import { reportsService } from './service.js';
import type { NextFunction, Request, Response } from 'express';

/**
 * HTTP-слой отчётов и вложенных ресурсов (summary, category-limits,
 * daily-expenses). Маршруты закрыты `authenticate` в router.ts, поэтому
 * id пользователя берётся из проверенного JWT.
 */
export class ReportsController {
  /** GET /reports → 200: список отчётов пользователя. */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const reports = await reportsService.list(req.user!.id);
      res.status(200).json({ data: reports });
    } catch (error) {
      next(error);
    }
  }

  /** POST /reports — body: { name, code?, hasDailyExpenses?, ... } → 201 + Location. */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const report = await reportsService.create(req.user!.id, req.body ?? {});
      res.status(201).location(`${req.originalUrl}/${report.id}`).json({ data: report });
    } catch (error) {
      next(error);
    }
  }

  /** GET /reports/:id → 200/404: один отчёт. */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const report = await reportsService.getById(req.user!.id, req.params.id);
      res.status(200).json({ data: report });
    } catch (error) {
      next(error);
    }
  }

  /** PATCH /reports/:id → 200: переименование или вкл/выкл daily-режима. */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const report = await reportsService.update(req.user!.id, req.params.id, req.body ?? {});
      res.status(200).json({ data: report });
    } catch (error) {
      next(error);
    }
  }

  /** DELETE /reports/:id → 204/404. */
  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await reportsService.remove(req.user!.id, req.params.id);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }

  /** GET /reports/:id/summary → 200: { income, expense, savings, daily }. */
  async getSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const summary = await reportsService.getSummary(req.user!.id, req.params.id);
      res.status(200).json({ data: summary });
    } catch (error) {
      next(error);
    }
  }

  /** GET /reports/:id/category-limits → 200: лимиты отчёта. */
  async getCategoryLimits(req: Request, res: Response, next: NextFunction) {
    try {
      const limits = await reportsService.getCategoryLimits(req.user!.id, req.params.id);
      res.status(200).json({ data: limits });
    } catch (error) {
      next(error);
    }
  }

  /** PUT /reports/:id/category-limits — body: { limits: [{categoryId, amount}] } → 200: новый список. */
  async setCategoryLimits(req: Request, res: Response, next: NextFunction) {
    try {
      const limits = await reportsService.setCategoryLimits(
        req.user!.id,
        req.params.id,
        req.body ?? {},
      );
      res.status(200).json({ data: limits });
    } catch (error) {
      next(error);
    }
  }

  /** POST /reports/:id/daily-expenses — body: { amount, description? } → 201: daily-операция. */
  async createDailyExpense(req: Request, res: Response, next: NextFunction) {
    try {
      const operation = await reportsService.createDailyExpense(
        req.user!.id,
        req.params.id,
        req.body ?? {},
      );
      res.status(201).json({ data: operation });
    } catch (error) {
      next(error);
    }
  }

  /** DELETE /reports/:id/daily-expenses → 204: отключение ежедневных расходов. */
  async disableDailyExpenses(req: Request, res: Response, next: NextFunction) {
    try {
      await reportsService.disableDailyExpenses(req.user!.id, req.params.id);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
}

export const reportsController = new ReportsController();
