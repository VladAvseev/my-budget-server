/**
 * Типы модуля users.
 *
 * Пользователь здесь — это то, чем в Supabase были auth.users + profiles
 * (см. db/schema.sql: обе таблицы слиты в одну `public.users`).
 * Клиентские аналоги: Profile в client/src/shared/supabase/types/domain.ts
 * и get_or_create_profile в useProfile.sql.
 */

/** Строка таблицы `users` ровно как её отдаёт postgres (snake_case, numeric — строкой). */
export interface UserRow {
  id: string;
  email: string;
  /** bcrypt-хэш — НИКОГДА не должен покидать сервер (в PublicUser его нет). */
  password_hash: string;
  role: 'user' | 'admin';
  /** numeric в драйвере pg всегда приходит строкой, конвертим при маппинге. */
  start_balance: string;
  currency: string | null;
  onboarded: boolean;
  last_active_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Публичное представление пользователя в API-ответах: без password_hash,
 * в camelCase (так же клиент получал jsonb из RPC Supabase).
 */
export interface PublicUser {
  id: string;
  email: string;
  role: 'user' | 'admin';
  startBalance: number;
  currency: string | null;
  onboarded: boolean;
  lastActiveAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Тело PATCH /users/me. Поля строго whitelisted — email и role
 * изменить нельзя (у Supabase email тоже жил отдельно от profiles).
 * Источник полей — StartBalanceCard и OnboardingCard клиента
 * (RPC update_start_balance / update_currency / complete_onboarding).
 */
export interface UpdateProfileInput {
  startBalance?: number;
  currency?: string | null;
  onboarded?: boolean;
}

/** Ответ GET /users/me/onboarding — счётчики для чек-листа (get_onboarding_state). */
export interface OnboardingState {
  categories: number;
  reports: number;
  operations: number;
}

/** Ответ GET /users/me/summary — сводка сумм по всем отчётам (get_user_summary). */
export interface UserSummary {
  income: number;
  expense: number;
  /** savings минус savings_out — «накоплено с учётом снятий». */
  savings: number;
  /** расходы из дневного бюджета. */
  daily: number;
}
