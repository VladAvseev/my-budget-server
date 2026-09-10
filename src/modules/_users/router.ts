import { authenticate } from '@/middlewares/authMiddleware.js';
import { Router } from 'express';
import { usersController } from './controller.js';

export const usersRouter = Router();

// Весь модуль требует авторизации: доступ к чужим данным отсекает
// middleware (дальше все запросы идут строго от id из проверенного JWT).
usersRouter.use(authenticate);

// GET /users/me (хук useProfile):
// профиль текущего пользователя: email, роль, start_balance, currency, onboarded.
usersRouter.get('/me', usersController.getMe);

// PATCH /users/me: { startBalance?, currency?, onboarded? } → обновлённый профиль.
usersRouter.patch('/me', usersController.updateMe);

// GET /users/me/onboarding (useOnboardingChecklist):
// счётчики категорий/отчётов/операций для чек-листа на главной.
usersRouter.get('/me/onboarding', usersController.getOnboardingState);

// GET /users/me/summary (useGlobalBalance):
// суммы операций по всем отчётам пользователя.
usersRouter.get('/me/summary', usersController.getSummary);
