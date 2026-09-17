import { usersService } from './service.js';
import type { NextFunction, Request, Response } from 'express';

export class UsersController {

  async getMe(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await usersService.getMe(req.user!.id);
      res.status(200).json({ data: user });
    } catch (error) {
      next(error);
    }
  }

  async updateMe(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await usersService.updateMe(req.user!.id, req.body ?? {});
      res.status(200).json({ data: user });
    } catch (error) {
      next(error);
    }
  }

  async getOnboardingState(req: Request, res: Response, next: NextFunction) {
    try {
      const state = await usersService.getOnboardingState(req.user!.id);
      res.status(200).json({ data: state });
    } catch (error) {
      next(error);
    }
  }

  async getSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const summary = await usersService.getSummary(req.user!.id);
      res.status(200).json({ data: summary });
    } catch (error) {
      next(error);
    }
  }

  async getBootstrap(req: Request, res: Response, next: NextFunction) {
    try {
      const bootstrap = await usersService.getBootstrap(req.user!.id);
      res.status(200).json({ data: bootstrap });
    } catch (error) {
      next(error);
    }
  }

  async deleteMe(req: Request, res: Response, next: NextFunction) {
    try {
      await usersService.deleteMe(req.user!.id, {
        ip: req.ip ?? 'unknown',
        userAgent: req.headers['user-agent'] ?? null,
      });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
}

export const usersController = new UsersController();
