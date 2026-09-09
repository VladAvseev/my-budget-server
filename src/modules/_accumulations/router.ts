import { Router } from 'express';
import { accumulationsController } from './controller.js';

export const accumulationsRouter = Router();

// GET /accumulations — RPC get_accumulations (хук useAccumulations): список
// накоплений пользователя (новые сверху). Страница «Накопления»
// (AccumulationsList, GoalsSection), глобальный баланс (useGlobalBalance).
accumulationsRouter.get('/', accumulationsController.list);

// POST /accumulations — RPC create_accumulation (хук useCreateAccumulation):
// добавление накопления из модалки CreateAccumulationModal
// (сумма, описание, savings-категория).
accumulationsRouter.post('/', accumulationsController.create);

// PATCH /accumulations/:id — RPC update_accumulation (хук
// useUpdateAccumulation): редактирование накопления из модалки
// EditAccumulationModal.
accumulationsRouter.patch('/:id', accumulationsController.update);

// DELETE /accumulations/:id — RPC delete_accumulation (хук
// useRemoveAccumulation): удаление накопления из AccumulationsList.
accumulationsRouter.delete('/:id', accumulationsController.remove);
