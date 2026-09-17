import { authenticate, requireAdmin } from '@/middlewares/authMiddleware.js';
import { requireConsent } from '@/middlewares/requireConsentMiddleware.js';
import { Router } from 'express';
import { adminController } from './controller.js';

export const adminRouter = Router();

adminRouter.use(authenticate, requireAdmin, requireConsent);

adminRouter.get('/dashboard/stats', adminController.getStats);

adminRouter.get('/dashboard/operations-dynamics', adminController.getOperationsDynamics);

adminRouter.get('/dashboard/storage-breakdown', adminController.getStorageBreakdown);

adminRouter.get('/users', adminController.listUsers);

adminRouter.get('/users/options', adminController.getUserOptions);

adminRouter.delete('/users/:userId', adminController.deleteUser);

adminRouter.get('/logs', adminController.listLogs);

adminRouter.get('/logs/metrics', adminController.getLogsMetrics);

adminRouter.get('/logs/dynamics', adminController.getLogsDynamics);
