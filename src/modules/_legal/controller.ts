import type { NextFunction, Request, Response } from 'express';
import { legalService } from './service.js';

/**
 * HTTP-слой выдачи юридических документов. Маршруты публичные (без Bearer):
 * текст согласия должен быть доступен и незалогиненному пользователю на
 * форме регистрации.
 */
export class LegalController {
  /** GET /legal/:documentType/current → 200: текущая опубликованная версия. */
  async getCurrent(req: Request, res: Response, next: NextFunction) {
    try {
      const doc = await legalService.getCurrent(req.params.documentType);
      // contentHash стабилен между правками — отдаём его сильным ETag:
      // браузер/прокси смогут ответить 304 без повторной передачи текста.
      res.setHeader('ETag', `"${doc.contentHash}"`);
      res.status(200).json({ data: doc });
    } catch (error) {
      next(error);
    }
  }

  /** GET /legal/:documentType/:version → 200: конкретная историческая версия. */
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
