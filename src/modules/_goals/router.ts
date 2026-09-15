import { authenticate } from '@/middlewares/authMiddleware.js';
import { requireConsent } from '@/middlewares/requireConsentMiddleware.js';
import { Router } from 'express';
import { goalsController } from './controller.js';

export const goalsRouter = Router();

// Все маршруты требуют Bearer access-токен: цели видны только владельцу.
// Плюс requireConsent — до принятия согласия финансовый функционал недоступен.
goalsRouter.use(authenticate, requireConsent);

// GET /goals (хук useGoals): цели накоплений пользователя
// Одна цель на счёт; закрытые счета исключены из секции «Капитал».
goalsRouter.get('/', goalsController.list);

// POST /goals (хук useCreateGoal): создание цели
// из модалки CreateGoalModal (открытый счёт, сумма, желаемая дата).
// 409, если цель на этот счёт уже есть (уникальный account_id).
goalsRouter.post('/', goalsController.create);

// PATCH /goals/:id (хук useUpdateGoal): изменение суммы
// и/или желаемой даты цели из модалки EditGoalModal.
goalsRouter.patch('/:id', goalsController.update);

// DELETE /goals/:id (хук useRemoveGoal): удаление цели
// по кнопке «Удалить цель» в модалке EditGoalModal.
goalsRouter.delete('/:id', goalsController.remove);
