import { usersService } from './service.js';
import type { NextFunction, Request, Response } from 'express';

/**
 * HTTP-слой профиля. Все маршруты модуля закрыты `authenticate` в router.ts,
 * поэтому `req.user` здесь гарантированно заполнен (id из проверенного JWT):
 * каждый запрос работает строго с id своего пользователя, доступ к чужим
 * строкам исключён на уровне сервера.
 */
export class UsersController {
  /** GET /users/me → 200: профиль (логин, роль, валюта, onboarded, даты). */
  async getMe(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await usersService.getMe(req.user!.id);
      res.status(200).json({ data: user });
    } catch (error) {
      next(error);
    }
  }

  /** PATCH /users/me → 200: обновлённый профиль. Тело: { currency?, onboarded? }. */
  async updateMe(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await usersService.updateMe(req.user!.id, req.body ?? {});
      res.status(200).json({ data: user });
    } catch (error) {
      next(error);
    }
  }

  /** GET /users/me/onboarding → 200: { categories, reports, operations } для чек-листа. */
  async getOnboardingState(req: Request, res: Response, next: NextFunction) {
    try {
      const state = await usersService.getOnboardingState(req.user!.id);
      res.status(200).json({ data: state });
    } catch (error) {
      next(error);
    }
  }

  /** GET /users/me/summary → 200: { income, expense } по всем операциям. */
  async getSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const summary = await usersService.getSummary(req.user!.id);
      res.status(200).json({ data: summary });
    } catch (error) {
      next(error);
    }
  }

  /** GET /users/me/bootstrap → 200: все цифры главной за один round-trip. */
  async getBootstrap(req: Request, res: Response, next: NextFunction) {
    try {
      const bootstrap = await usersService.getBootstrap(req.user!.id);
      res.status(200).json({ data: bootstrap });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /users/me → 204: обезличивание аккаунта вместе с данными (п.5/п.7).
   * Идемпотентен для клиента: после успеха access-JWT доживает TTL, но сессий
   * (refresh) больше нет, а вход в обезличенный аккаунт невозможен.
   */
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
