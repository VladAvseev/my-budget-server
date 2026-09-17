import { authenticate } from '@/middlewares/authMiddleware.js';
import { requireConsent } from '@/middlewares/requireConsentMiddleware.js';
import { Router } from 'express';
import { categoriesController } from './controller.js';

export const categoriesRouter = Router();

categoriesRouter.use(authenticate, requireConsent);

categoriesRouter.get('/', categoriesController.list);

categoriesRouter.post('/', categoriesController.create);

categoriesRouter.patch('/:id', categoriesController.update);

categoriesRouter.delete('/:id', categoriesController.remove);
