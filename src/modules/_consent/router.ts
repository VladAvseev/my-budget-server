import { authenticate } from '@/middlewares/authMiddleware.js';
import { Router } from 'express';
import { consentController } from './controller.js';

export const consentRouter = Router();

consentRouter.use(authenticate);

// Маршруты СОЗНАТЕЛЬНО без requireConsent: GET статуса нужен, чтобы понять,
// показывать ли gate, а grant/revoke — единственные действия, доступные
// в состоянии NEEDS_CONSENT.

// GET /consent/status → { needsConsent, reason, currentVersion, grantedVersion }
// для consent-gate и профиля.
consentRouter.get('/status', consentController.getStatus);

// POST /consent/grant — принять текущую версию согласия (consent-gate).
consentRouter.post('/grant', consentController.grant);

// POST /consent/revoke — отозвать согласие: данные обезличиваются сразу,
// журнал остаётся (п.7 требований).
consentRouter.post('/revoke', consentController.revoke);
