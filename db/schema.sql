-- Схема целевой БД my-budget server: PostgreSQL 16 (образ postgres:16 в docker-compose).
-- Файл приводит пустую БД к структуре, которая к этапу 1 перехода на аккаунты
-- сложилась в рабочей БД; на живой базе целиком не запускать — только идемпотентные
-- файлы из db/migrations.
--
-- Этап 1: старые накопления и savings/savings_out заменяются аккаунтами и переводами.
--   * users.start_balance удалён, деньги пользователя хранятся в accounts.initial_balance;
--   * накопления превращены в accounts, savings/savings_out — в operations.type = 'transfer';
--   * удалены таблицы accumulations и goals, а также type='savings' у categories.
--
-- Типы категорий: 'income' (доход) и 'expense' (расход) — для обычных операций,
-- 'daily' — для ежедневных операций (учитываются в расходе дня, но не в структуре отчёта).
-- Накопительные категории удалены: для целей накопления теперь используются accounts.
-- CHECK: CONSTRAINT categories_type_check CHECK (type = ANY (ARRAY['income'::text, 'expense'::text, 'daily'::text]))
CREATE TABLE IF NOT EXISTS public.categories (
    id uuid default gen_random_uuid() not null primary key,
    name text not null,
    icon text,
    color text,
    sort_order integer default 0 not null,
    created_at timestamp with time zone default now() not null,
    user_id uuid not null references public.users(id) on delete cascade,
    parent_id uuid references public.categories(id) on delete cascade,
    type text default 'expense'::text not null,
    archived boolean default false not null,
    CONSTRAINT categories_type_check CHECK (type = ANY (ARRAY['income'::text, 'expense'::text, 'daily'::text]))
);

-- Аккаунты пользователя: основной счёт, накопления и будущие отдельные кошельки.
-- Ровно один основной счёт на пользователя обеспечивается частичным уникальным индексом;
-- users не ссылается на accounts, чтобы избежать циклической зависимости.
CREATE TABLE IF NOT EXISTS public.accounts (
    id uuid default gen_random_uuid() not null primary key,
    user_id uuid not null references public.users(id) on delete cascade,
    name text not null,
    initial_balance numeric default 0 not null,
    is_closed boolean default false not null,
    is_primary boolean default false not null,
    created_at timestamp with time zone default now() not null,
    updated_at timestamp with time zone default now() not null
);

CREATE INDEX IF NOT EXISTS accounts_user_id_idx ON public.accounts USING btree (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS accounts_one_primary_key ON public.accounts USING btree (user_id) WHERE is_primary;

-- Пользователи. Стартовый баланс больше не хранится здесь: он вынесен в accounts.initial_balance.
CREATE TABLE IF NOT EXISTS public.users (
    id uuid default gen_random_uuid() not null primary key,
    created_at timestamp with time zone default now() not null,
    login text not null unique,
    email text,
    password text not null,
    role text default 'user'::text not null,
    avatar_url text,
    created_by uuid references public.users(id) on delete set null,
    invited_by uuid references public.users(id) on delete set null,
    last_active_at timestamp with time zone default now() not null,
    registration_date timestamp with time zone default now() not null,
    failed_login_attempts integer default 0 not null,
    locked_until timestamp with time zone,
    CONSTRAINT users_role_check CHECK (role = ANY (ARRAY['user'::text, 'admin'::text]))
);

-- Активные сессии (refresh-токены).
CREATE TABLE IF NOT EXISTS public.refresh_tokens (
    id uuid default gen_random_uuid() not null primary key,
    user_id uuid not null references public.users(id) on delete cascade,
    token_hash text not null unique,
    expires_at timestamp with time zone not null,
    created_at timestamp with time zone default now() not null,
    user_agent text
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON public.refresh_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON public.refresh_tokens(user_id);

-- Расширяемые настройки аккаунта (схема настроек описана на клиенте).
CREATE TABLE IF NOT EXISTS public.user_settings (
    user_id uuid primary key references public.users(id) on delete cascade,
    settings jsonb not null default '{}'::jsonb,
    updated_at timestamp with time zone not null default now()
);

-- Заметки администратора о пользователе (одна на автора).
CREATE TABLE IF NOT EXISTS public.admin_notes (
    id uuid default gen_random_uuid() not null primary key,
    user_id uuid not null references public.users(id) on delete cascade,
    author_id uuid references public.users(id) on delete set null,
    text text not null,
    created_at timestamp with time zone default now() not null,
    updated_at timestamp with time zone default now() not null
);
CREATE INDEX IF NOT EXISTS idx_admin_notes_user_id ON public.admin_notes(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_notes_author_id ON public.admin_notes(author_id);

-- Операции: тип 'income' (доход), 'expense' (расход), 'daily' (ежедневная)
-- и 'transfer' (перевод между аккаунтами: заполняются from_account_id/to_account_id).
CREATE TABLE IF NOT EXISTS public.operations (
    id uuid default gen_random_uuid() not null primary key,
    user_id uuid references public.users(id) on delete cascade,
    date date not null,
    time time without time zone,
    type text not null,
    account_id uuid references public.accounts(id) on delete set null,
    from_account_id uuid references public.accounts(id) on delete set null,
    to_account_id uuid references public.accounts(id) on delete set null,
    amount numeric not null,
    category_id uuid references public.categories(id) on delete set null,
    description text,
    report_id uuid references public.reports(id) on delete set null,
    created_at timestamp with time zone default now() not null,
    updated_at timestamp with time zone default now() not null,
    CONSTRAINT operations_type_check CHECK (type = ANY (ARRAY['income'::text, 'expense'::text, 'daily'::text, 'transfer'::text]))
);

-- Лимиты расходов по категориям для отчётов.
CREATE TABLE IF NOT EXISTS public.category_limits (
    id uuid default gen_random_uuid() not null primary key,
    report_id uuid not null references public.reports(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    category_id uuid not null references public.categories(id) on delete cascade,
    amount numeric not null,
    period text not null,
    created_at timestamp with time zone default now() not null,
    updated_at timestamp with time zone default now() not null,
    CONSTRAINT category_limits_period_check CHECK (period = ANY (ARRAY['week'::text, 'month'::text, 'quarter'::text, 'year'::text]))
);

-- Группы категорий для пользовательских отчётов.
CREATE TABLE IF NOT EXISTS public.category_group_assignments (
    id uuid default gen_random_uuid() not null primary key,
    report_id uuid not null references public.reports(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    category_id uuid not null references public.categories(id) on delete cascade,
    group_name text not null,
    created_at timestamp with time zone default now() not null,
    updated_at timestamp with time zone default now() not null
);

-- Пользовательские отчёты: конфигурация хранится в JSONB (см. client/src/features/reports).
CREATE TABLE IF NOT EXISTS public.reports (
    id uuid default gen_random_uuid() not null primary key,
    user_id uuid not null references public.users(id) on delete cascade,
    name text not null,
    type text not null,
    data jsonb not null,
    time_range text,
    start_date date,
    end_date date,
    report_period text not null default 'none'::text,
    custom_start_day integer,
    created_at timestamp with time zone default now() not null,
    updated_at timestamp with time zone default now() not null,
    CONSTRAINT reports_type_check CHECK (type = ANY (ARRAY['category'::text, 'custom'::text]))
);

-- Настройки групп в отчётах (исключение/прочее).
CREATE TABLE IF NOT EXISTS public.report_group_overrides (
    id uuid default gen_random_uuid() not null primary key,
    report_id uuid not null references public.reports(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    group_name text not null,
    category_ids text not null,
    is_excluded boolean default false not null,
    is_other boolean default false not null,
    created_at timestamp with time zone default now() not null,
    updated_at timestamp with time zone default now() not null
);

-- Пользовательский старт расчётного периода («месяц с 5-го числа»).
-- Один раз на весь отчёт (report_id = null) или на конкретную группу.
CREATE TABLE IF NOT EXISTS public.report_period_settings (
    id uuid default gen_random_uuid() not null primary key,
    user_id uuid not null references public.users(id) on delete cascade,
    report_id uuid references public.reports(id) on delete cascade,
    group_name text,
    period_start jsonb not null,
    created_at timestamp with time zone default now() not null,
    updated_at timestamp with time zone default now() not null
);

-- Лог входящих запросов и ошибок (пишет requestLoggingMiddleware, смотрит админка).
-- Писали без IP и User-Agent: они занимали основной объём таблицы и не использовались
-- в фильтрах; ошибки ищутся по тексту, авторизованность — по is_authenticated.
-- UUID- и числовые сегменты пути пишутся как :id: иначе топы группировали бы каждый id
-- отдельной строкой.
CREATE TABLE IF NOT EXISTS public.request_logs (
    id bigint generated always as identity primary key,
    created_at timestamp with time zone default now() not null,
    method text not null,
    path text not null,
    status_code integer not null,
    duration_ms integer not null,
    error_text text,
    user_id uuid references public.users(id) on delete set null,
    is_authenticated boolean not null default false,
    user_role text
);
-- Мягкое условие для старых строк (колонку добавили миграцией, заполняем выборочно).
ALTER TABLE public.request_logs DROP CONSTRAINT IF EXISTS request_logs_user_role_check;
ALTER TABLE public.request_logs ADD CONSTRAINT request_logs_user_role_check
  CHECK (user_role is null or user_role in ('user', 'admin'));

CREATE INDEX IF NOT EXISTS idx_categories_user_id ON public.categories USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_categories_created_at ON public.categories USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_categories_type ON public.categories USING btree (type);

CREATE INDEX IF NOT EXISTS idx_operations_created_at ON public.operations USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_operations_user_id ON public.operations USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_operations_type ON public.operations USING btree (type);
CREATE INDEX IF NOT EXISTS idx_operations_date ON public.operations USING btree (date);
CREATE INDEX IF NOT EXISTS idx_operations_category_id ON public.operations USING btree (category_id);
CREATE INDEX IF NOT EXISTS idx_operations_report_id ON public.operations USING btree (report_id);
CREATE INDEX IF NOT EXISTS idx_operations_user_date ON public.operations USING btree (user_id, date);
CREATE INDEX IF NOT EXISTS idx_operations_account_id ON public.operations USING btree (account_id);
CREATE INDEX IF NOT EXISTS idx_operations_from_account_id ON public.operations USING btree (from_account_id);
CREATE INDEX IF NOT EXISTS idx_operations_to_account_id ON public.operations USING btree (to_account_id);

CREATE INDEX IF NOT EXISTS idx_requests_user_id ON public.reports USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_requests_type ON public.reports USING btree (type);

CREATE INDEX IF NOT EXISTS idx_category_limits_report_id ON public.category_limits USING btree (report_id);
CREATE INDEX IF NOT EXISTS idx_category_limits_user_id ON public.category_limits USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_category_limits_category_id ON public.category_limits USING btree (category_id);

CREATE INDEX IF NOT EXISTS idx_report_group_overrides_report_id ON public.report_group_overrides USING btree (report_id);
CREATE INDEX IF NOT EXISTS idx_report_group_overrides_user_id ON public.report_group_overrides USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_category_group_assignments_report_id ON public.category_group_assignments USING btree (report_id);
CREATE INDEX IF NOT EXISTS idx_category_group_assignments_user_id ON public.category_group_assignments USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_category_group_assignments_category_id ON public.category_group_assignments USING btree (category_id);

CREATE INDEX IF NOT EXISTS idx_report_period_settings_user_id ON public.report_period_settings USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_report_period_settings_report_id ON public.report_period_settings USING btree (report_id);

CREATE INDEX IF NOT EXISTS idx_request_logs_created_at ON public.request_logs USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_request_logs_path_status ON public.request_logs USING btree (path, status_code);

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.seed_default_categories_for_user()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO public.categories (user_id, name, type, icon, color)
  VALUES
    (NEW.id, 'Зарплата', 'income', '💼', '#4CAF50'),
    (NEW.id, 'Фриланс', 'income', '💻', '#8BC34A'),
    (NEW.id, 'Подарки', 'income', '🎁', '#FF9800'),
    (NEW.id, 'Продукты', 'expense', '🛒', '#2196F3'),
    (NEW.id, 'Транспорт', 'expense', '🚌', '#9C27B0'),
    (NEW.id, 'Развлечения', 'expense', '🎮', '#E91E63'),
    (NEW.id, 'Кафе и рестораны', 'expense', '🍽️', '#FF5722'),
    (NEW.id, 'Жильё', 'expense', '🏠', '#795548'),
    (NEW.id, 'Здоровье', 'expense', '💊', '#00BCD4'),
    (NEW.id, 'Кофе', 'daily', '☕', '#F44336'),
    (NEW.id, 'Обед', 'daily', '🍜', '#FFC107'),
    (NEW.id, 'Транспорт (ежедневный)', 'daily', '🚇', '#607D8B'),
    (NEW.id, 'Продукты (ежедневные)', 'daily', '🥖', '#3F51B5')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_categories_updated_at ON public.categories;
CREATE TRIGGER trg_categories_updated_at BEFORE UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_operations_updated_at ON public.operations;
CREATE TRIGGER trg_operations_updated_at BEFORE UPDATE ON public.operations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_accounts_updated_at ON public.accounts;
CREATE TRIGGER trg_accounts_updated_at BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_category_limits_updated_at ON public.category_limits;
CREATE TRIGGER trg_category_limits_updated_at BEFORE UPDATE ON public.category_limits FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_report_group_overrides_updated_at ON public.report_group_overrides;
CREATE TRIGGER trg_report_group_overrides_updated_at BEFORE UPDATE ON public.report_group_overrides FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_category_group_assignments_updated_at ON public.category_group_assignments;
CREATE TRIGGER trg_category_group_assignments_updated_at BEFORE UPDATE ON public.category_group_assignments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_report_period_settings_updated_at ON public.report_period_settings;
CREATE TRIGGER trg_report_period_settings_updated_at BEFORE UPDATE ON public.report_period_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_seed_default_categories ON public.users;
CREATE TRIGGER trg_seed_default_categories AFTER INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION public.seed_default_categories_for_user();

-- Row Level Security не включаем: доступ к данным контролируется сервером через
-- user_id в каждом запросе.
