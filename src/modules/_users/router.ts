import { authenticate } from '@/middlewares/authMiddleware.js';
import { Router } from 'express';
import { usersController } from './controller.js';

export const usersRouter = Router();

usersRouter.use(authenticate);

usersRouter.get('/me', usersController.getMe);

usersRouter.patch('/me', usersController.updateMe);

usersRouter.get('/me/onboarding', usersController.getOnboardingState);

usersRouter.get('/me/summary', usersController.getSummary);

usersRouter.get('/me/bootstrap', usersController.getBootstrap);

usersRouter.delete('/me', usersController.deleteMe);
