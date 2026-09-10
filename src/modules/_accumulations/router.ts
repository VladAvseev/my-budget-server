import { authenticate } from '@/middlewares/authMiddleware.js';
import { Router } from 'express';
import { accumulationsController } from './controller.js';

export const accumulationsRouter = Router();

// Все маршруты требуют Bearer access-токен: накопления видны только владельцу.
accumulationsRouter.use(authenticate);

// GET /accumulations (хук useAccumulations): список
// накоплений пользователя (новые сверху). Страница «Накопления»
// (AccumulationsList, GoalsSection), глобальный баланс (useGlobalBalance).
accumulationsRouter.get('/', accumulationsController.list);

// POST /accumulations (хук useCreateAccumulation):
// добавление накопления из модалки CreateAccumulationModal
// (сумма, описание, savings-категория).
accumulationsRouter.post('/', accumulationsController.create);

// PATCH /accumulations/:id (хук
// useUpdateAccumulation): редактирование накопления из модалки
// EditAccumulationModal.
accumulationsRouter.patch('/:id', accumulationsController.update);

// DELETE /accumulations/:id (хук
// useRemoveAccumulation): удаление накопления из AccumulationsList.
accumulationsRouter.delete('/:id', accumulationsController.remove);
