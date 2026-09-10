import { usersService } from './service.js';
import type { NextFunction, Request, Response } from 'express';

/**
 * HTTP-слой профиля. Все маршруты модуля закрыты `authenticate` в router.ts,
 * поэтому `req.user` здесь гарантированно заполнен (id из проверенного JWT):
 * каждый запрос работает строго с id своего пользователя, доступ к чужим
 * строкам исключён на уровне сервера.
 */
export class UsersController {
  /** GET /users/me → 200: профиль (email, роль, баланс, валюта, onboarded, даты). */
  async getMe(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await usersService.getMe(req.user!.id);
      res.status(200).json({ data: user });
    } catch (error) {
      next(error);
    }
  }

  /** PATCH /users/me → 200: обновлённый профиль. Тело: { startBalance?, currency?, onboarded? }. */
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

  /** GET /users/me/summary → 200: { income, expense, savings, daily } по всем отчётам. */
  async getSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const summary = await usersService.getSummary(req.user!.id);
      res.status(200).json({ data: summary });
    } catch (error) {
      next(error);
    }
  }
}

export const usersController = new UsersController();
