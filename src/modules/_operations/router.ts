import { authenticate } from '@/middlewares/authMiddleware.js';
import { requireConsent } from '@/middlewares/requireConsentMiddleware.js';
import { Router } from 'express';
import { operationsController } from './controller.js';

export const operationsRouter = Router();

operationsRouter.use(authenticate, requireConsent);

operationsRouter.get('/', operationsController.list);

operationsRouter.get('/months', operationsController.listMonths);

operationsRouter.get('/capital-dynamics', operationsController.getCapitalDynamics);

operationsRouter.get('/category-summary', operationsController.getCategorySummary);

operationsRouter.post('/', operationsController.create);

operationsRouter.patch('/:id', operationsController.update);

operationsRouter.delete('/:id', operationsController.remove);
