import { authenticate } from '@/middlewares/authMiddleware.js';
import { Router } from 'express';
import { goalsController } from './controller.js';

export const goalsRouter = Router();

// Все маршруты требуют Bearer access-токен: цели видны только владельцу.
goalsRouter.use(authenticate);

// GET /goals (хук useGoals): цели накоплений пользователя
// (одна цель на savings-категорию). Секция целей на странице «Накопления»
// (GoalsSection) и карточка накоплений на главной (AccumulationsCard).
goalsRouter.get('/', goalsController.list);

// POST /goals (хук useCreateGoal): создание цели
// из модалки CreateGoalModal (savings-категория, сумма, желаемая дата).
// 409, если цель на эту категорию уже есть (уникальна user_id + category_id).
goalsRouter.post('/', goalsController.create);

// PATCH /goals/:id (хук useUpdateGoal): изменение суммы
// и/или желаемой даты цели из модалки EditGoalModal.
goalsRouter.patch('/:id', goalsController.update);

// DELETE /goals/:id (хук useRemoveGoal): удаление цели
// по кнопке «Удалить цель» в модалке EditGoalModal.
goalsRouter.delete('/:id', goalsController.remove);
