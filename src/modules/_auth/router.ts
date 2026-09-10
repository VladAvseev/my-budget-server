import { authenticate } from '@/middlewares/authMiddleware.js';
import { authRateLimitMiddleware } from '@/middlewares/rateLimitMiddleware.js';
import { Router } from 'express';
import { authController } from './controller.js';

export const authRouter = Router();

// POST /auth/register - тело: { email, password }.
// Замена supabase.auth.signUp: создаёт строку в users (пароль — bcrypt-хэш)
// и сразу выдаёт пару токенов access+refresh (email-confirmation нет).
authRouter.post('/register', authRateLimitMiddleware, authController.register);

// POST /auth/login - тело: { email, password }.
// Замена supabase.auth.signInWithPassword: сверка bcrypt-хэша, новая
// запись в refresh_tokens (одна строка = одно устройство/сессия).
authRouter.post('/login', authRateLimitMiddleware, authController.login);

// POST /auth/refresh - тело: { refreshToken }.
// Замена supabase.auth.refreshSession (autoRefreshToken на клиенте):
// ротация — старый refresh отзывается, выдаётся новая пара.
authRouter.post('/refresh', authController.refresh);

// POST /auth/logout - тело: { refreshToken } → 204.
// Замена supabase.auth.signOut: отзыв текущей сессии, другие устройства живы.
// Bearer не требуется: доказательство владения сессией — сам refresh-токен.
authRouter.post('/logout', authController.logout);

// PATCH /auth/password - тело: { newPassword }, обязателен Bearer access-токен.
// Замена supabase.auth.updateUser({ password }): новый bcrypt-хэш +
// отзыв всех refresh-токенов (logout на остальных устройствах).
authRouter.patch('/password', authenticate, authController.updatePassword);
