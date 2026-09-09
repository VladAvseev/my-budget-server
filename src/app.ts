import { errorMiddleware } from '@/middlewares/errorMiddleware.js';
import { notFoundMiddleware } from '@/middlewares/notFoundMiddleware.js';
import { rateLimitMiddleware } from '@/middlewares/rateLimitMiddleware.js';
import { apiRouter } from '@/router.js';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

export const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(rateLimitMiddleware);
app.use(express.json());
app.use('/api/v1', apiRouter);
app.use(notFoundMiddleware);
app.use(errorMiddleware);
