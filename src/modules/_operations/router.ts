import { authenticate } from '@/middlewares/authMiddleware.js';
import { requireConsent } from '@/middlewares/requireConsentMiddleware.js';
import { Router } from 'express';
import { operationsController } from './controller.js';

export const operationsRouter = Router();

// Все маршруты требуют Bearer access-токен: операции видны только их владельцу.
// Поверх — requireConsent: без действующего согласия на обработку ПДн доступ
// к финансовым данным закрыт (п.5 требований), клиент по 403 CONSENT_REQUIRED
// показывает блокирующий consent-gate.
operationsRouter.use(authenticate, requireConsent);

// GET /operations?reportId=&type=: операции отчёта; типы можно перечислить через запятую.
// Допустимы income, expense, transfer.
// GET /operations?reportIds=: сводка по набору отчётов.
operationsRouter.get('/', operationsController.list);

// GET /operations/category-summary?reportIds= (хук useOverviewCategorySummary):
// серверная сводка сумм по отчёту/типу/категории для аналитики на главной.
operationsRouter.get('/category-summary', operationsController.getCategorySummary);

// POST /operations (хук useCreateOperation): создание
// операции внутри отчёта из формы OperationForm на странице отчёта
// (тип, сумма, категория, описание, дата, счета).
operationsRouter.post('/', operationsController.create);

// PATCH /operations/:id (хук useUpdateOperation):
// редактирование операции из карточки операции (OperationCardBase).
operationsRouter.patch('/:id', operationsController.update);

// DELETE /operations/:id (хук useRemoveOperation):
// удаление операции по кнопке на карточке операции.
operationsRouter.delete('/:id', operationsController.remove);
