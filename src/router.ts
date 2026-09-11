import { Router } from 'express';
import { accumulationsRouter } from '@/modules/_accumulations/router.js';
import { adminRouter } from '@/modules/_admin/router.js';
import { authRouter } from '@/modules/_auth/router.js';
import { categoriesRouter } from '@/modules/_categories/router.js';
import { goalsRouter } from '@/modules/_goals/router.js';
import { operationsRouter } from '@/modules/_operations/router.js';
import { reportsRouter } from '@/modules/_reports/router.js';
import { usersRouter } from '@/modules/_users/router.js';

export const apiRouter = Router();

// Публичного /health в API больше нет: эндпоинт только информировал сканеры
// о состоянии сервера и нагружал пул БД проверкой на каждый запрос.

apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/reports', reportsRouter);
apiRouter.use('/operations', operationsRouter);
apiRouter.use('/categories', categoriesRouter);
apiRouter.use('/accumulations', accumulationsRouter);
apiRouter.use('/goals', goalsRouter);
apiRouter.use('/admin', adminRouter);
