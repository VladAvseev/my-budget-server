import { rateLimit, MINUTE } from 'express-rate-limit';

export const rateLimitMiddleware = rateLimit({
  windowMs: MINUTE,
  limit: 1000,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { message: 'Превышен лимит запросов. Попробуйте позже.', status: 429 } },
});

/**
 * Ужесточённый лимит на перебор паролей: /auth/login и /auth/register.
 * Глобальный лимит (1000/мин) брутфорс практически не сдерживает — bcrypt(10)
 * замедляет, но не останавливает атакующего. 10 попыток за 15 минут на IP
 * оставляет реальному пользователю достаточно попыток перепутать пароль.
 */
export const authRateLimitMiddleware = rateLimit({
  windowMs: 15 * MINUTE,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    error: { message: 'Слишком много попыток. Повторите через 15 минут.', status: 429 },
  },
});
