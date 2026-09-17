import { Router } from 'express';
import { legalController } from './controller.js';

export const legalRouter = Router();

legalRouter.get('/:documentType/current', legalController.getCurrent);

legalRouter.get('/:documentType/:version', legalController.getVersion);
