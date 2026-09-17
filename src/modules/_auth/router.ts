import { authenticate } from '@/middlewares/authMiddleware.js';
import { authRateLimitMiddleware } from '@/middlewares/rateLimitMiddleware.js';
import { Router } from 'express';
import { authController } from './controller.js';

export const authRouter = Router();

authRouter.post('/register', authRateLimitMiddleware, authController.register);

authRouter.post('/login', authRateLimitMiddleware, authController.login);

authRouter.post('/refresh', authRateLimitMiddleware, authController.refresh);

authRouter.post('/logout', authRateLimitMiddleware, authController.logout);

authRouter.patch('/password', authenticate, authController.updatePassword);
