import { pool } from '@/db/pool.js';
import type {
  OnboardingState,
  PublicUser,
  UpdateProfileInput,
  UserRow,
  UserSummary,
} from './types.js';

/**
 * Преобразование строки БД в DTO для API-ответа:
 * убираем password_hash и переводим snake_case → camelCase
 * (клиентские типы исторически в camelCase, так UI не менять).
 */
export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    // numeric в драйвере pg — это всегда строка ("1500.50"), иначе теряется точность;
    // для балансов бытового масштаба double безопасно.
    startBalance: Number(row.start_balance),
    currency: row.currency,
    onboarded: row.onboarded,
    lastActiveAt: row.last_active_at ? row.last_active_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class UsersRepository {
  /** Полный профиль по id; null — пользователя нет (ид был из подделанного JWT). */
  async getById(id: string): Promise<UserRow | null> {
    const { rows } = await pool.query<UserRow>('SELECT * FROM public.users WHERE id = $1', [id]);
    return rows[0] ?? null;
  }

  /**
   * Выборочное обновление профиля. Поля принимаются только из whitelist
   * (startBalance/currency/onboarded) — SQL-инъекция через имена полей
   * исключена, значения всегда уходят параметрами $n.
   */
  async update(id: string, input: UpdateProfileInput): Promise<UserRow | null> {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (input.startBalance !== undefined) {
      values.push(input.startBalance);
      sets.push(`start_balance = $${values.length}`);
    }
    if (input.currency !== undefined) {
      values.push(input.currency);
      sets.push(`currency = $${values.length}`);
    }
    if (input.onboarded !== undefined) {
      values.push(input.onboarded);
      sets.push(`onboarded = $${values.length}`);
    }

    // Нечего обновлять — просто возвращаем текущую строку (PATCH идемпотентен).
    if (sets.length === 0) {
      return this.getById(id);
    }

    sets.push('updated_at = now()');
    values.push(id);

    const { rows } = await pool.query<UserRow>(
      `UPDATE public.users SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values,
    );
    return rows[0] ?? null;
  }

  /**
   * Счётчики для онбординг-чеклиста (порт get_onboarding_state из useOnboardingChecklist.sql):
   * сколько сущностей пользователь уже создал — UI по ней подсвечивает выполненные шаги.
   * count(*) приходит из pg строкой (bigint), поэтому ::int + Number().
   */
  async getOnboardingState(userId: string): Promise<OnboardingState> {
    const { rows } = await pool.query<{
      categories: number;
      reports: number;
      operations: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM public.categories WHERE user_id = $1) AS categories,
         (SELECT count(*)::int FROM public.reports    WHERE user_id = $1) AS reports,
         (SELECT count(*)::int FROM public.operations WHERE user_id = $1) AS operations`,
      [userId],
    );
    const row = rows[0];
    return {
      categories: Number(row.categories),
      reports: Number(row.reports),
      operations: Number(row.operations),
    };
  }

  /**
   * Сводка по всем операциям пользователя (порт get_user_summary из useGlobalBalance.sql):
   * суммы по типам за всё время, 'savings' минус 'savings_out' — чистые накопления.
   */
  async getSummary(userId: string): Promise<UserSummary> {
    const { rows } = await pool.query<{
      income: string;
      expense: string;
      savings: string;
      daily: string;
    }>(
      `SELECT
         coalesce(sum(amount::numeric) FILTER (WHERE type = 'income'), 0)         AS income,
         coalesce(sum(amount::numeric) FILTER (WHERE type = 'expense'), 0)        AS expense,
         coalesce(sum(amount::numeric) FILTER (WHERE type = 'savings'), 0)
           - coalesce(sum(amount::numeric) FILTER (WHERE type = 'savings_out'), 0) AS savings,
         coalesce(sum(amount::numeric) FILTER (WHERE type = 'daily'), 0)          AS daily
       FROM public.operations
       WHERE user_id = $1`,
      [userId],
    );
    const row = rows[0];
    return {
      income: Number(row.income),
      expense: Number(row.expense),
      savings: Number(row.savings),
      daily: Number(row.daily),
    };
  }
}

export const usersRepository = new UsersRepository();
