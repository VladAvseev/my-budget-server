import { authenticate } from '@/middlewares/authMiddleware.js';
import { requireConsent } from '@/middlewares/requireConsentMiddleware.js';
import { Router } from 'express';
import { reportsController } from './controller.js';

export const reportsRouter = Router();

reportsRouter.use(authenticate, requireConsent);

reportsRouter.get('/', reportsController.list);

reportsRouter.get('/capital-dynamics', reportsController.getCapitalDynamics);

reportsRouter.post('/', reportsController.create);

reportsRouter.get('/:id', reportsController.getById);

reportsRouter.patch('/:id', reportsController.update);

reportsRouter.delete('/:id', reportsController.remove);

reportsRouter.get('/:id/summary', reportsController.getSummary);

reportsRouter.get('/:id/category-limits', reportsController.getCategoryLimits);

reportsRouter.put('/:id/category-limits', reportsController.setCategoryLimits);
