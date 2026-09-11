import { authenticate } from '@/middlewares/authMiddleware.js';
import { Router } from 'express';
import { accumulationsController } from './controller.js';

export const accumulationsRouter = Router();

accumulationsRouter.use(authenticate);

accumulationsRouter.get('/', accumulationsController.list);

accumulationsRouter.get('/total', accumulationsController.total);

accumulationsRouter.post('/', accumulationsController.create);

accumulationsRouter.patch('/:id', accumulationsController.update);

accumulationsRouter.delete('/:id', accumulationsController.remove);
