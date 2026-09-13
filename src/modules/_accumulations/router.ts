import { authenticate } from '@/middlewares/authMiddleware.js';
import { requireConsent } from '@/middlewares/requireConsentMiddleware.js';
import { Router } from 'express';
import { accumulationsController } from './controller.js';

export const accumulationsRouter = Router();

// Данные пользователя — доступ только с действующим согласием на обработку ПДн.
accumulationsRouter.use(authenticate, requireConsent);

accumulationsRouter.get('/', accumulationsController.list);

accumulationsRouter.get('/total', accumulationsController.total);

accumulationsRouter.get('/dynamics', accumulationsController.dynamics);

accumulationsRouter.post('/', accumulationsController.create);

accumulationsRouter.patch('/:id', accumulationsController.update);

accumulationsRouter.delete('/:id', accumulationsController.remove);
