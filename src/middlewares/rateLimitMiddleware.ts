import { rateLimit, MINUTE } from 'express-rate-limit';

export const rateLimitMiddleware = rateLimit({
  windowMs: MINUTE,
  limit: 1000,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { message: 'Превышен лимит запросов. Попробуйте позже.', status: 429 } },
});

export const authRateLimitMiddleware = rateLimit({
  windowMs: 15 * MINUTE,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    error: { message: 'Слишком много попыток. Повторите через 15 минут.', status: 429 },
  },
});
