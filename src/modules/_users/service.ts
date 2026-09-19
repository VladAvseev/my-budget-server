import { usersRepository, toPublicUser, isAnonymizedLogin } from './repository.js';
import { accountsRepository, toAccountDto } from '@/modules/_accounts/repository.js';
import { goalsRepository, toGoalDto } from '@/modules/_goals/repository.js';
import { operationsRepository, toOperationDto } from '@/modules/_operations/repository.js';
import type { OperationType } from '@/modules/_operations/types.js';
import { pool } from '@/db/pool.js';
import { consentService } from '@/modules/_consent/service.js';
import { AppError } from '@/shared/appError.js';
import type { ConsentRequestMeta } from '@/modules/_consent/types.js';
import { buildBootstrapGoalsSummary, emptyGoalsSummary } from './goalsSummary.js';
import type {
  GoalsSummary,
  HomeBootstrap,
  OnboardingState,
  PublicUser,
  UpdateProfileInput,
  UserSummary,
} from './types.js';

export class UsersService {
  async getMe(userId: string): Promise<PublicUser> {
    const user = await usersRepository.getById(userId);
    if (!user) {
      throw new AppError('Пользователь не найден', 404);
    }
    return toPublicUser(user);
  }

  async updateMe(userId: string, body: Record<string, unknown>): Promise<PublicUser> {
    const input: UpdateProfileInput = {};

    if (body.currency !== undefined) {
      if (
        body.currency !== null &&
        (typeof body.currency !== 'string' || body.currency.length > 10)
      ) {
        throw new AppError('Некорректная валюта', 400);
      }
      input.currency = body.currency;
    }

    if (body.onboarded !== undefined) {
      if (typeof body.onboarded !== 'boolean') {
        throw new AppError('Поле onboarded должно быть булевым', 400);
      }
      input.onboarded = body.onboarded;
    }

    if (Object.keys(input).length === 0) {
      throw new AppError('Не передано ни одного поля для обновления', 400);
    }

    const updated = await usersRepository.update(userId, input);
    if (!updated) {
      throw new AppError('Пользователь не найден', 404);
    }
    return toPublicUser(updated);
  }

  async getOnboardingState(userId: string): Promise<OnboardingState> {
    return usersRepository.getOnboardingState(userId);
  }

  async getSummary(userId: string): Promise<UserSummary> {
    return usersRepository.getSummary(userId);
  }

  async getBootstrap(userId: string): Promise<HomeBootstrap> {
    const bootstrap = await usersRepository.getHomeBootstrap(userId);
    if (!bootstrap) {
      throw new AppError('Пользователь не найден', 404);
    }
    return { ...bootstrap, goalsSummary: await this.getGoalsSummary(userId) };
  }

  private async getGoalsSummary(userId: string): Promise<GoalsSummary> {
    const [goalRows, accountRows, user] = await Promise.all([
      goalsRepository.list(userId),
      accountsRepository.list(userId),
      usersRepository.getById(userId),
    ]);
    if (!user || goalRows.length === 0) {
      return emptyGoalsSummary();
    }
    const [{ rows: monthRows }, dynamics] = await Promise.all([
      pool.query<{ month: string }>(`SELECT to_char(CURRENT_DATE, 'YYYY-MM') AS month`),
      operationsRepository.listCapitalDynamics(userId),
    ]);
    const month = monthRows[0]?.month;
    const types: OperationType[] = ['income', 'expense', 'transfer'];
    const operationRows = month
      ? await operationsRepository.listByMonths([month], userId, types)
      : [];
    return buildBootstrapGoalsSummary({
      goals: goalRows.map(toGoalDto),
      accounts: accountRows.map(toAccountDto),
      operations: operationRows.map(toOperationDto),
      dynamics,
      firstActivityDate: user.created_at,
    });
  }

  async deleteMe(userId: string, meta: ConsentRequestMeta): Promise<void> {
    const user = await usersRepository.getById(userId);
    if (!user || isAnonymizedLogin(user.login)) {
      throw new AppError('Пользователь не найден', 404);
    }
    await consentService.revokeAndErase(userId, meta, 'account_settings');
  }
}

export const usersService = new UsersService();
