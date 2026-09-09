import { authService } from './service.js';
import type { NextFunction, Request, Response } from 'express';
import type { RequestMeta } from './types.js';

/**
 * HTTP-слой авторизации: только разбор запроса и отдача ответа,
 * вся логика — в service.ts. Ответы заворачиваются в `{ data }`,
 * ошибки бросаются AppError'ом и доезжают до errorMiddleware.
 */

/**
 * От кого запрос: сохраняем в refresh_tokens, чтобы сессии-устройства
 * можно было различать (аналог device information в Supabase).
 * Функция уровня модуля, а не метод класса: Express вызывает контроллеры
 * без привязки контекста (`this` там undefined).
 */
function meta(req: Request): RequestMeta {
  return { userAgent: req.headers['user-agent'], ip: req.ip };
}

export class AuthController {
  /** POST /auth/register — body: { email, password } → 201 + сессия. */
  async register(req: Request, res: Response, next: NextFunction) {
    try {
      const session = await authService.register(req.body ?? {}, meta(req));
      res.status(201).json({ data: session });
    } catch (error) {
      next(error);
    }
  }

  /** POST /auth/login — body: { email, password } → 200 + сессия. */
  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const session = await authService.login(req.body ?? {}, meta(req));
      res.status(200).json({ data: session });
    } catch (error) {
      next(error);
    }
  }

  /** POST /auth/refresh — body: { refreshToken } → 200 + новая пара (ротация). */
  async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const session = await authService.refresh(req.body?.refreshToken, meta(req));
      res.status(200).json({ data: session });
    } catch (error) {
      next(error);
    }
  }

  /** POST /auth/logout — body: { refreshToken } → 204, отзыв текущей сессии. */
  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      await authService.logout(req.body?.refreshToken);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /auth/password — body: { newPassword }, требует Bearer access-токена.
   * 204 — клиент после смены сам делает logout/перелогин (все refresh отозваны).
   */
  async updatePassword(req: Request, res: Response, next: NextFunction) {
    try {
      // req.user гарантированно есть: маршрут закрыт authenticate выше.
      await authService.updatePassword(req.user!.id, req.body ?? {});
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
}

export const authController = new AuthController();
