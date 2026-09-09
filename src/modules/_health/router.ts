import { Router } from 'express';
import { healthController } from './controller.js';

export const healthRouter = Router();

healthRouter.get('/', healthController.getHealth);
