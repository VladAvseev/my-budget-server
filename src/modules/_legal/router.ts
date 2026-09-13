import { Router } from 'express';
import { legalController } from './controller.js';

export const legalRouter = Router();

// Публичные маршруты (без authenticate): текст документа нужен и на форме
// регистрации незалогиненным пользователям. Глобальный rate-limit 1000/мин
// покрывает от спама; кэш клиента — по ETag/contentHash.

// GET /legal/:documentType/current — текущая опубликованная версия.
legalRouter.get('/:documentType/current', legalController.getCurrent);

// GET /legal/:documentType/:version — историческая версия (для споров
// о том, какой текст видел пользователь в момент согласия).
legalRouter.get('/:documentType/:version', legalController.getVersion);
