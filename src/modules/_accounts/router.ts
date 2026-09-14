import { Router } from 'express';
import { authenticate } from '@/middlewares/authMiddleware.js';
import { requireConsent } from '@/middlewares/requireConsentMiddleware.js';
import { accountsController } from './controller.js';

export const accountsRouter = Router();
accountsRouter.use(authenticate, requireConsent);
accountsRouter.get('/', accountsController.list);
accountsRouter.get('/:id', accountsController.get);
accountsRouter.post('/', accountsController.create);
accountsRouter.patch('/:id', accountsController.update);
accountsRouter.delete('/:id', accountsController.remove);
