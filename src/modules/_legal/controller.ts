import type { NextFunction, Request, Response } from 'express';
import { legalService } from './service.js';

export class LegalController {

  async getCurrent(req: Request, res: Response, next: NextFunction) {
    try {
      const doc = await legalService.getCurrent(req.params.documentType);

      res.setHeader('ETag', `"${doc.contentHash}"`);
      res.status(200).json({ data: doc });
    } catch (error) {
      next(error);
    }
  }

  async getVersion(req: Request, res: Response, next: NextFunction) {
    try {
      const doc = await legalService.getVersion(req.params.documentType, req.params.version);
      res.setHeader('ETag', `"${doc.contentHash}"`);
      res.status(200).json({ data: doc });
    } catch (error) {
      next(error);
    }
  }
}

export const legalController = new LegalController();
