import { rateLimit, MINUTE } from 'express-rate-limit';

export const rateLimitMiddleware = rateLimit({
  windowMs: MINUTE,
  limit: 1000,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { message: 'Превышен лимит запросов. Попробуйте позже.', status: 429 } },
});
