/**
 * Типы модуля users.
 *
 * Аккаунт и профиль живут в одной таблице `public.users` (см. db/schema.sql):
 * роль, стартовый баланс, валюта и отметка активности — её колонки.
 * Формы ответов совпадают с тем, что клиент получал от прежнего бэкенда.
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
  /** Счётчик неудачных входов подряд (временная блокировка, логика в _auth/service.ts). */
  failed_login_attempts: number;
  /** До какого момента вход заблокирован; null — блокировки нет. */
  locked_until: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Публичное представление пользователя в API-ответах: без password_hash,
 * в camelCase (так же клиент получал данные от прежнего бэкенда).
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
 * Тело PATCH /users/me. Поля строго whitelisted: меняются только стартовый
 * баланс, валюта и флаг онбординга — email и роль через этот эндпоинт
 * изменить нельзя.
 * Источник полей — StartBalanceCard и OnboardingCard клиента.
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
