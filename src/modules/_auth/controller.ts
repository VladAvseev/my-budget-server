import { authService } from './service.js';
import type { NextFunction, Request, Response } from 'express';
import type { RequestMeta } from './types.js';

function meta(req: Request): RequestMeta {
  return { userAgent: req.headers['user-agent'], ip: req.ip };
}

export class AuthController {

  async register(req: Request, res: Response, next: NextFunction) {
    try {
      const session = await authService.register(req.body ?? {}, meta(req));
      res.status(201).json({ data: session });
    } catch (error) {
      next(error);
    }
  }

  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const session = await authService.login(req.body ?? {}, meta(req));
      res.status(200).json({ data: session });
    } catch (error) {
      next(error);
    }
  }

  async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const session = await authService.refresh(req.body?.refreshToken, meta(req));
      res.status(200).json({ data: session });
    } catch (error) {
      next(error);
    }
  }

  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      await authService.logout(req.body?.refreshToken);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }

  async updatePassword(req: Request, res: Response, next: NextFunction) {
    try {

      await authService.updatePassword(req.user!.id, req.body ?? {});
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
}

export const authController = new AuthController();
