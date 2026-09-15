import { accountsRepository } from '@/modules/_accounts/repository.js';
import { withAccountTransaction } from '@/shared/accountRules.js';
import { AppError } from '@/shared/appError.js';
import { optionalDateOrNull, requireAmount, requireUuid } from '@/shared/validate.js';
import { goalsRepository, toGoalDto } from './repository.js';
import type { GoalDto, UpdateGoalInput } from './types.js';

function goalDate(value: unknown): string | null {
  const date = optionalDateOrNull(value, 'Целевая дата в формате YYYY-MM-DD');
  if (date !== null) {
    const parsed = new Date(`${date}T00:00:00Z`);
    if (
      date.startsWith('0000') ||
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date
    ) {
      throw new AppError('Укажите существующую календарную дату', 400);
    }
  }
  return date;
}

function validateBody(body: Record<string, unknown>, allowed: string[]): void {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !allowed.includes(key))
  ) {
    throw new AppError('Переданы неподдерживаемые поля цели', 400);
  }
}

export class GoalsService {
  async list(userId: string): Promise<GoalDto[]> {
    return (await goalsRepository.list(userId)).map(toGoalDto);
  }

  async create(userId: string, body: Record<string, unknown>): Promise<GoalDto> {
    validateBody(body, ['accountId', 'amount', 'targetDate']);
    const accountId = requireUuid(body.accountId, 'Некорректный идентификатор счёта');
    const amount = requireAmount(body.amount, 'Сумма цели должна быть положительным числом');
    const targetDate = goalDate(body.targetDate);
    try {
      return await withAccountTransaction(userId, async (client) => {
        const account = await accountsRepository.get(userId, accountId, client);
        if (!account) throw new AppError('Счёт не найден', 404);
        if (account.is_closed) throw new AppError('Для закрытого счёта нельзя создать цель', 400);
        return toGoalDto(
          await goalsRepository.create(client, userId, { accountId, amount, targetDate }),
        );
      });
    } catch (error) {
      const pg = error as { code?: string; constraint?: string };
      if (pg.code === '23505' && pg.constraint === 'goals_account_id_key') {
        throw new AppError('Цель для этого счёта уже существует', 409);
      }
      throw error;
    }
  }

  async update(userId: string, id: unknown, body: Record<string, unknown>): Promise<GoalDto> {
    const goalId = requireUuid(id);
    validateBody(body, ['amount', 'targetDate']);
    const input: UpdateGoalInput = {};
    if (body.amount !== undefined) {
      input.amount = requireAmount(body.amount, 'Сумма цели должна быть положительным числом');
    }
    if (body.targetDate !== undefined) {
      input.targetDate = goalDate(body.targetDate);
    }
    if (!Object.keys(input).length)
      throw new AppError('Не передано ни одного поля для обновления', 400);
    return withAccountTransaction(userId, async (client) => {
      const row = await goalsRepository.update(client, goalId, userId, input);
      if (!row) throw new AppError('Цель не найдена', 404);
      return toGoalDto(row);
    });
  }

  async remove(userId: string, id: unknown): Promise<void> {
    const goalId = requireUuid(id);
    await withAccountTransaction(userId, async (client) => {
      if (!(await goalsRepository.remove(client, goalId, userId))) {
        throw new AppError('Цель не найдена', 404);
      }
    });
  }
}
export const goalsService = new GoalsService();
