/**
 * Типы модуля users.
 *
 * Аккаунт и профиль живут в одной таблице `public.users` (см. db/schema.sql):
 * роль, валюта и отметка активности — её колонки. Стартовый баланс вынесен в
 * `accounts.initial_balance`, накопления — тоже счета, а не профиль.
 * Формы ответов совпадают с тем, что клиент получает от REST-бэкенда.
 */

/** Строка таблицы `users` ровно как её отдаёт postgres (snake_case, numeric — строкой). */
export interface UserRow {
  id: string;
  login: string;
  /** bcrypt-хэш — НИКОГДА не должен покидать сервер (в PublicUser его нет). */
  password_hash: string;
  role: 'user' | 'admin';
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
  login: string;
  role: 'user' | 'admin';
  currency: string | null;
  onboarded: boolean;
  lastActiveAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Тело PATCH /users/me. Поля строго whitelisted: меняются только валюта
 * и флаг онбординга — логин и роль через этот эндпоинт изменить нельзя.
 * Источник полей — AccountsSection и OnboardingCard клиента.
 */
export interface UpdateProfileInput {
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
  /** расходы из дневного бюджета. */
  daily: number;
}

/**
 * Ответ GET /users/me/bootstrap — все «цифры» главной за один round-trip.
 * Агрегаты считает PostgreSQL (один CTE-запрос); карточки клиента читают
 * срезы этого DTO. Гранулярные эндпоинты (/reports, /accounts, …)
 * остаются для своих страниц — bootstrap только для главной.
 */
export interface HomeBootstrap {
  /** Срез профиля, нужный главной (остальное — в PublicUser). */
  profile: {
    currency: string | null;
    onboarded: boolean;
  };
  /** Счётчики онбординг-чеклиста (та же форма, что у /users/me/onboarding). */
  onboarding: OnboardingState;
  /** Карточка «Последний период»: отчёт с максимальной period_end + его сводка. */
  lastReport: BootstrapLastReport | null;
  /** Глобальные суммы по всем операциям. */
  globalTotals: UserSummary;
}

/** Элемент lastReport в bootstrap: ключи отчёта — как в _reports.ReportDto. */
export interface BootstrapLastReport {
  id: string;
  name: string;
  /** 'YYYY-MM-DD' | null (DATE-парсер отключён в pool.ts). */
  period_start: string | null;
  period_end: string | null;
  /** Сводка сумм по типам операций отчёта (та же форма, что у /users/me/summary). */
  summary: UserSummary;
}
