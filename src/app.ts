import { errorMiddleware } from '@/middlewares/errorMiddleware.js';
import { notFoundMiddleware } from '@/middlewares/notFoundMiddleware.js';
import { rateLimitMiddleware } from '@/middlewares/rateLimitMiddleware.js';
import { requestLoggingMiddleware } from '@/middlewares/requestLoggingMiddleware.js';
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
// CORS нужен ТОЛЬКО браузерным запросам с другого origin. Прод-топология
// same-origin (nginx web-контейнера проксирует /api/ на этот сервер), поэтому
// по умолчанию заголовок Access-Control-Allow-Origin не отдаётся вообще и
// чужие сайты API не читают. CORS_ORIGIN задавать точным origin ('https://домен',
// без завершающего слэша) только если клиент уедет на отдельный домен.
// Раньше здесь был дефолт '*', который бесплатно открывал публичные эндпоинты
// любой веб-странице в интернете — убрано.
app.use(cors({ origin: process.env.CORS_ORIGIN }));
app.use(rateLimitMiddleware);
app.use(express.json());
// Логи пишутся в public.request_logs (таблица из db/schema.sql), просмотр —
// /admin/logs; тела запросов/ответов не сохраняются.
app.use(requestLoggingMiddleware);
app.use('/api/v1', apiRouter);
app.use(notFoundMiddleware);
app.use(errorMiddleware);
