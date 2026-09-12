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
  login: string;
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
  login: string;
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
 * баланс, валюта и флаг онбординга — логин и роль через этот эндпоинт
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

/**
 * Ответ GET /users/me/bootstrap — все «цифры» главной за один round-trip.
 * Агрегаты считает PostgreSQL (один CTE-запрос); карточки клиента читают
 * срезы этого DTO. Гранулярные эндпоинты (/reports, /accumulations, …)
 * остаются для своих страниц — bootstrap только для главной.
 */
export interface HomeBootstrap {
  /** Срез профиля, нужный главной (остальное — в PublicUser). */
  profile: {
    startBalance: number;
    currency: string | null;
    onboarded: boolean;
  };
  /** Счётчики онбординг-чеклиста (та же форма, что у /users/me/onboarding). */
  onboarding: OnboardingState;
  /** Карточка «Последний период»: отчёт с максимальной period_end + его сводка. */
  lastReport: BootstrapLastReport | null;
  /** Глобальные суммы по всем операциям + сумма накоплений (стартовый капитал). */
  globalTotals: UserSummary & { accumulationsTotal: number };
  /** Структура накоплений по категориям (карточка «Накопления»). */
  savingsStructure: BootstrapSavingsItem[];
  /** Цели без вычислений: общий прогресс считает клиент (shared/utils/goals.ts). */
  goals: BootstrapGoalItem[];
}

/** Элемент lastReport в bootstrap: ключи отчёта — как в _reports.ReportDto. */
export interface BootstrapLastReport {
  id: string;
  name: string;
  /** 'YYYY-MM-DD' | null (DATE-парсер отключён в pool.ts). */
  period_start: string | null;
  period_end: string | null;
  /** Сводка сумм по типам операций отчёта (форма _reports.ReportSummary). */
  summary: UserSummary;
}

/** Элемент savingsStructure: сумма accumulations + знаковых savings-операций. */
export interface BootstrapSavingsItem {
  /** null — накопления без категории (лейбл рисует клиент). */
  categoryId: string | null;
  name: string | null;
  color: string | null;
  amount: number;
}

/** Элемент goals: unique(user_id, category_id) — одна цель на категорию. */
export interface BootstrapGoalItem {
  categoryId: string;
  amount: number;
}
