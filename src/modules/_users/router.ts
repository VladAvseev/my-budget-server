import { authenticate } from '@/middlewares/authMiddleware.js';
import { Router } from 'express';
import { usersController } from './controller.js';

export const usersRouter = Router();

// Весь модуль требует авторизации: вместо RLS-политики Supabase
// (`auth.uid() = user_id`) доступ к чужим данным отсекает middleware.
usersRouter.use(authenticate);

// GET /users/me - аналог RPC get_or_create_profile (хук useProfile):
// профиль текущего пользователя: email, роль, start_balance, currency, onboarded.
usersRouter.get('/me', usersController.getMe);

// PATCH /users/me - объединяет RPC update_start_balance / update_currency /
// complete_onboarding: { startBalance?, currency?, onboarded? } → обновлённый профиль.
usersRouter.patch('/me', usersController.updateMe);

// GET /users/me/onboarding - аналог get_onboarding_state (useOnboardingChecklist):
// счётчики категорий/отчётов/операций для чек-листа на главной.
usersRouter.get('/me/onboarding', usersController.getOnboardingState);

// GET /users/me/summary - аналог get_user_summary (useGlobalBalance):
// суммы операций по всем отчётам пользователя.
usersRouter.get('/me/summary', usersController.getSummary);
