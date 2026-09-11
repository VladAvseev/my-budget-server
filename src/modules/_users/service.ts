import { usersRepository, toPublicUser } from './repository.js';
import { AppError } from '@/shared/appError.js';
import type {
  HomeBootstrap,
  OnboardingState,
  PublicUser,
  UpdateProfileInput,
  UserSummary,
} from './types.js';

/**
 * Бизнес-логика профиля пользователя.
 * Строку пользователя гарантирует модуль auth (регистрация делает INSERT),
 * поэтому GET /users/me просто читает; если строки нет — значит токен от
 * удалённого аккаунта (404).
 */
export class UsersService {
  async getMe(userId: string): Promise<PublicUser> {
    const user = await usersRepository.getById(userId);
    if (!user) {
      throw new AppError('Пользователь не найден', 404);
    }
    return toPublicUser(user);
  }

  /** Разбор и проверка PATCH /users/me — только whitelisted поля. */
  async updateMe(userId: string, body: Record<string, unknown>): Promise<PublicUser> {
    const input: UpdateProfileInput = {};

    // startBalance: число >= 0 — как в StartBalanceCard клиента (amount >= 0).
    if (body.startBalance !== undefined) {
      const value = Number(body.startBalance);
      if (!Number.isFinite(value) || value < 0) {
        throw new AppError('Стартовый баланс должен быть неотрицательным числом', 400);
      }
      input.startBalance = value;
    }

    // currency: ISO-код ('RUB', 'USD', ...) или null = сбросить выбор.
    if (body.currency !== undefined) {
      if (
        body.currency !== null &&
        (typeof body.currency !== 'string' || body.currency.length > 10)
      ) {
        throw new AppError('Некорректная валюта', 400);
      }
      input.currency = body.currency;
    }

    // onboarded: флаг пройденного онбординга (кнопка «Завершить» в OnboardingCard).
    if (body.onboarded !== undefined) {
      if (typeof body.onboarded !== 'boolean') {
        throw new AppError('Поле onboarded должно быть булевым', 400);
      }
      input.onboarded = body.onboarded;
    }

    // Пустой объект — валидных полей нет; просим хотя бы одно, чтобы не делать холостой запрос.
    if (Object.keys(input).length === 0) {
      throw new AppError('Не передано ни одного поля для обновления', 400);
    }

    const updated = await usersRepository.update(userId, input);
    if (!updated) {
      throw new AppError('Пользователь не найден', 404);
    }
    return toPublicUser(updated);
  }

  /** Счётчики для чек-листа на главной (OnboardingCard). */
  async getOnboardingState(userId: string): Promise<OnboardingState> {
    return usersRepository.getOnboardingState(userId);
  }

  /** Глобальная сводка сумм по всем отчётам (AppLayout, useGlobalBalance). */
  async getSummary(userId: string): Promise<UserSummary> {
    return usersRepository.getSummary(userId);
  }

  /** GET /users/me/bootstrap — все цифры главной одним ответом. */
  async getBootstrap(userId: string): Promise<HomeBootstrap> {
    const bootstrap = await usersRepository.getHomeBootstrap(userId);
    if (!bootstrap) {
      throw new AppError('Пользователь не найден', 404);
    }
    return bootstrap;
  }
}

export const usersService = new UsersService();
