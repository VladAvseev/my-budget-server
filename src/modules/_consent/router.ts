import { authenticate } from '@/middlewares/authMiddleware.js';
import { Router } from 'express';
import { consentController } from './controller.js';

export const consentRouter = Router();

consentRouter.use(authenticate);

consentRouter.get('/status', consentController.getStatus);

consentRouter.post('/grant', consentController.grant);

consentRouter.post('/revoke', consentController.revoke);
