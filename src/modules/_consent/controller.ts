import type { NextFunction, Request, Response } from 'express';
import { consentService } from './service.js';
import type { ConsentRequestMeta } from './types.js';

function meta(req: Request): ConsentRequestMeta {
  return { ip: req.ip ?? 'unknown', userAgent: req.headers['user-agent'] ?? null };
}

export class ConsentController {

  async getStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const state = await consentService.getState(req.user!.id);
      res.status(200).json({ data: state });
    } catch (error) {
      next(error);
    }
  }

  async grant(req: Request, res: Response, next: NextFunction) {
    try {
      const state = await consentService.grant(req.user!.id, meta(req));
      res.status(200).json({ data: state });
    } catch (error) {
      next(error);
    }
  }

  async revoke(req: Request, res: Response, next: NextFunction) {
    try {
      await consentService.revokeAndErase(req.user!.id, meta(req), 'account_settings');
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
}

export const consentController = new ConsentController();
