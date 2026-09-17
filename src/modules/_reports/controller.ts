import { reportsService } from './service.js';
import type { NextFunction, Request, Response } from 'express';

export class ReportsController {

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const reports = await reportsService.list(req.user!.id);
      res.status(200).json({ data: reports });
    } catch (error) {
      next(error);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const report = await reportsService.create(req.user!.id, req.body ?? {});
      res.status(201).location(`${req.originalUrl}/${report.id}`).json({ data: report });
    } catch (error) {
      next(error);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const report = await reportsService.getById(req.user!.id, req.params.id);
      res.status(200).json({ data: report });
    } catch (error) {
      next(error);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const report = await reportsService.update(req.user!.id, req.params.id, req.body ?? {});
      res.status(200).json({ data: report });
    } catch (error) {
      next(error);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await reportsService.remove(req.user!.id, req.params.id);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }

  async getSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const summary = await reportsService.getSummary(req.user!.id, req.params.id);
      res.status(200).json({ data: summary });
    } catch (error) {
      next(error);
    }
  }

  async getCapitalDynamics(req: Request, res: Response, next: NextFunction) {
    try {
      const months = await reportsService.getCapitalDynamics(req.user!.id);
      res.status(200).json({ data: months });
    } catch (error) {
      next(error);
    }
  }

  async getCategoryLimits(req: Request, res: Response, next: NextFunction) {
    try {
      const limits = await reportsService.getCategoryLimits(req.user!.id, req.params.id);
      res.status(200).json({ data: limits });
    } catch (error) {
      next(error);
    }
  }

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
}

export const reportsController = new ReportsController();
