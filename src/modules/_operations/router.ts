import { authenticate } from '@/middlewares/authMiddleware.js';
import { Router } from 'express';
import { operationsController } from './controller.js';

export const operationsRouter = Router();

// Все маршруты требуют Bearer access-токен: операции видны только их владельцу.
operationsRouter.use(authenticate);

// GET /operations?reportId={id}&type={type} (хуки useOperations, useSavingsReportOperations):
// операции одного отчёта, отфильтрованные по типу
// (income/expense/savings/savings_out/daily). type допускает csv
// ('savings,savings_out') — обе savings-ветки одной вкладкой одним запросом.
// Вкладки «Доходы», «Расходы», «Накопления», «Ежедневные» на странице отчёта
// (OperationList, DailyOperationsTab).
// GET /operations?reportIds={id1,id2,...}: операции по набору отчётов
// (исторический режим для overview; сам overview теперь берёт
// GET /operations/category-summary).
operationsRouter.get('/', operationsController.list);

// GET /operations/savings (хук useSavingsOperations): все пополнения и снятия
// накоплений пользователя
// с названием и периодом отчёта. Карточка «Накопления» на главной
// (AccumulationsCard), список операций накоплений и GoalsSection.
operationsRouter.get('/savings', operationsController.getSavings);

// GET /operations/category-summary?reportIds= (хук useOverviewCategorySummary):
// серверная сводка сумм по отчёту/типу/категории для аналитики на главной.
operationsRouter.get('/category-summary', operationsController.getCategorySummary);

// POST /operations (хук useCreateOperation): создание
// операции внутри отчёта из формы OperationForm на странице отчёта
// (тип, сумма, категория, описание, дата).
operationsRouter.post('/', operationsController.create);

// PATCH /operations/:id (хук useUpdateOperation):
// редактирование операции из карточки операции (OperationCardBase).
operationsRouter.patch('/:id', operationsController.update);

// DELETE /operations/:id (хук useRemoveOperation):
// удаление операции по кнопке на карточке операции.
operationsRouter.delete('/:id', operationsController.remove);
