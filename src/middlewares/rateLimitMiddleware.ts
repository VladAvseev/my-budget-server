import { rateLimit, MINUTE } from 'express-rate-limit';

export const rateLimitMiddleware = rateLimit({
  windowMs: MINUTE,
  limit: 1000,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { message: 'Превышен лимит запросов. Попробуйте позже.', status: 429 } },
});

/**
 * Ужесточённый лимит на перебор паролей и спам auth-эндпоинтов:
 * /auth/login, /auth/register, /auth/refresh, /auth/logout.
 * Глобальный лимит (1000/мин) брутфорс практически не сдерживает — bcrypt(10)
 * замедляет, но не останавливает атакующего. 5 попыток за 15 минут на IP:
 * реальному пользователю хватает перепутать пароль и перелогиниться, а для
 * перебора это практически нулевая пропускная способность (второй слой —
 * временная блокировка аккаунта по счётчику неудач, см. _auth/service.ts).
 */
export const authRateLimitMiddleware = rateLimit({
  windowMs: 15 * MINUTE,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    error: { message: 'Слишком много попыток. Повторите через 15 минут.', status: 429 },
  },
});
