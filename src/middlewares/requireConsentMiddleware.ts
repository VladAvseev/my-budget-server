import { consentService } from '@/modules/_consent/service.js';
import { AppError } from '@/shared/appError.js';
import type { NextFunction, Request, Response } from 'express';

export async function requireConsent(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      throw new AppError('Требуется авторизация', 401);
    }
    await consentService.ensureConsent(req.user.id);
    next();
  } catch (error) {

    next(error);
  }
}
