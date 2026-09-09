import { errorMiddleware } from '@/middlewares/errorMiddleware.js';
import { notFoundMiddleware } from '@/middlewares/notFoundMiddleware.js';
import { rateLimitMiddleware } from '@/middlewares/rateLimitMiddleware.js';
import { apiRouter } from '@/router.js';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

export const app = express();

// Прод-топология: браузер → хостовый nginx (TLS) → nginx web-контейнера →
// этот сервер. Две доверенных прокси-скобки, чтобы:
//   * req.ip содержал реальный адрес клиента (пишется в refresh_tokens.ip);
//   * express-rate-limit (v8) не падал с ERR_ERL_UNEXPECTED_X_FORWARDED_FOR,
//     получая X-Forwarded-For от прокси. В dev (без прокси) setting безвреден.
app.set('trust proxy', 2);

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(rateLimitMiddleware);
app.use(express.json());
app.use('/api/v1', apiRouter);
app.use(notFoundMiddleware);
app.use(errorMiddleware);
