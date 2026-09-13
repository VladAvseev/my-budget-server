import type { NextFunction, Request, Response } from 'express';
import { consentService } from './service.js';
import type { ConsentRequestMeta } from './types.js';

/**
 * HTTP-слой consent-gate. Все маршруты за authenticate; события журнала
 * пишет только сервер, клиент управляет лишь фактом нажатия кнопки.
 */

/** Функция уровня модуля: Express вызывает контроллеры без привязки `this`. */
function meta(req: Request): ConsentRequestMeta {
  return { ip: req.ip ?? 'unknown', userAgent: req.headers['user-agent'] ?? null };
}

export class ConsentController {
  /** GET /consent/status → 200: состояние для gate'а (всегда доступен). */
  async getStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const state = await consentService.getState(req.user!.id);
      res.status(200).json({ data: state });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /consent/grant → 200: новое состояние после принятия.
   * Версию документа сервер берёт из is_current сам — тело у запроса нет.
   */
  async grant(req: Request, res: Response, next: NextFunction) {
    try {
      const state = await consentService.grant(req.user!.id, meta(req));
      res.status(200).json({ data: state });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /consent/revoke → 204: отзыв согласия с немедленным обезличиванием
   * данных (п.7). 204 — клиент после успеха сам выходит (сессии уже отозваны).
   */
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
