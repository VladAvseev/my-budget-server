import { consentService } from '@/modules/_consent/service.js';
import { AppError } from '@/shared/appError.js';
import type { NextFunction, Request, Response } from 'express';

/**
 * Надстройка над `authenticate`: пускает в бизнес-модули (отчёты, операции,
 * категории, накопления, цели, админ-статистика) только пользователей с
 * действующим согласием на обработку ПДн (п.5 требований — серверная часть
 * consent-gate).
 *
 * Состояние проверяет consentService.ensureConsent с коротким кэшем, поэтому
 * middleware не добавляет SELECT на каждый запрос. Провал — 403 с кодом
 * CONSENT_REQUIRED: клиент по коду показывает блокирующий gate, а не текст
 * ошибки из тоста.
 *
 * НЕ вешается на /auth, /users (профиль, смена пароля, удаление аккаунта) и
 * /consent: пользователь в состоянии NEEDS_CONSENT должен сохранять путь к
 * принятию согласия или удалению аккаунта (п.5).
 */
export async function requireConsent(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      throw new AppError('Требуется авторизация', 401);
    }
    await consentService.ensureConsent(req.user.id);
    next();
  } catch (error) {
    // Express 4 не ловит rejected promise async-функции — только next(err).
    next(error);
  }
}
