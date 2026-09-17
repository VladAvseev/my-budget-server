import { Router } from 'express';
import { accountsRouter } from '@/modules/_accounts/router.js';
import { adminRouter } from '@/modules/_admin/router.js';
import { authRouter } from '@/modules/_auth/router.js';
import { categoriesRouter } from '@/modules/_categories/router.js';
import { consentRouter } from '@/modules/_consent/router.js';
import { goalsRouter } from '@/modules/_goals/router.js';
import { legalRouter } from '@/modules/_legal/router.js';
import { operationsRouter } from '@/modules/_operations/router.js';
import { reportsRouter } from '@/modules/_reports/router.js';
import { usersRouter } from '@/modules/_users/router.js';

export const apiRouter = Router();

apiRouter.use('/legal', legalRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/consent', consentRouter);
apiRouter.use('/reports', reportsRouter);
apiRouter.use('/operations', operationsRouter);
apiRouter.use('/accounts', accountsRouter);
apiRouter.use('/categories', categoriesRouter);
apiRouter.use('/goals', goalsRouter);
apiRouter.use('/admin', adminRouter);
