import { authenticate } from '@/middlewares/authMiddleware.js';
import { requireConsent } from '@/middlewares/requireConsentMiddleware.js';
import { Router } from 'express';
import { goalsController } from './controller.js';

export const goalsRouter = Router();

goalsRouter.use(authenticate, requireConsent);

goalsRouter.get('/', goalsController.list);

goalsRouter.post('/', goalsController.create);

goalsRouter.patch('/:id', goalsController.update);

goalsRouter.delete('/:id', goalsController.remove);
