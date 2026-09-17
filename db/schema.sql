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
-- Типы категорий: 'income' (доход) и 'expense' (расход) — для обычных операций.
-- Накопительные категории удалены: для целей накопления теперь используются accounts.
-- CHECK: CONSTRAINT categories_type_check CHECK (type = ANY (ARRAY['income'::text, 'expense'::text]))
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
    CONSTRAINT categories_type_check CHECK (type = ANY (ARRAY['income'::text, 'expense'::text]))
);

-- Аккаунты пользователя: основной счёт, накопления и будущие отдельные кошельки.
-- Не более одного основного счёта обеспечивает индекс; наличие проверяет отложенный триггер;
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

-- Цели по счетам; при закрытии цель сохраняется до повторного открытия.
CREATE TABLE IF NOT EXISTS public.goals (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    account_id uuid NOT NULL CONSTRAINT goals_account_id_key UNIQUE
        REFERENCES public.accounts(id) ON DELETE CASCADE,
    amount numeric NOT NULL CONSTRAINT goals_amount_check
        CHECK (amount > 0 AND amount < 'Infinity'::numeric),
    target_date date,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS goals_user_id_idx ON public.goals(user_id);

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

-- Операции: тип 'income' (доход), 'expense' (расход)
-- и 'transfer' (перевод между аккаунтами: заполняются from_account_id/to_account_id).
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
    report_id uuid references public.reports(id) on delete cascade,
    created_at timestamp with time zone default now() not null,
    updated_at timestamp with time zone default now() not null,
    CONSTRAINT operations_type_check CHECK (type = ANY (ARRAY['income'::text, 'expense'::text, 'transfer'::text]))
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
    status smallint not null,
    duration_ms integer not null,
    error text,
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

CREATE INDEX IF NOT EXISTS request_logs_created_at_idx ON public.request_logs USING btree (created_at desc);
CREATE INDEX IF NOT EXISTS request_logs_status_created_at_idx ON public.request_logs USING btree (status, created_at desc);
CREATE INDEX IF NOT EXISTS request_logs_user_id_idx ON public.request_logs USING btree (user_id, created_at desc);
CREATE INDEX IF NOT EXISTS request_logs_user_role_created_at_idx ON public.request_logs USING btree (user_role, created_at desc);

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
    (NEW.id, 'Здоровье', 'expense', '💊', '#00BCD4')
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

DROP TRIGGER IF EXISTS trg_seed_default_categories ON public.users;
CREATE TRIGGER trg_seed_default_categories AFTER INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION public.seed_default_categories_for_user();

-- Row Level Security не включаем: доступ к данным контролируется сервером через
-- user_id в каждом запросе.


-- Начало общего блока защиты счетов (также в schema.sql).
create unique index if not exists accounts_one_primary_key
  on public.accounts (user_id) where is_primary;
alter table public.accounts drop constraint if exists accounts_primary_open_check;
alter table public.accounts add constraint accounts_primary_open_check
  check (not is_primary or not is_closed);

create or replace function public.protect_primary_account()
returns trigger language plpgsql as $$
declare owner_ids uuid[];
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'Нельзя очистить таблицу счетов'
      using errcode = '23514', constraint = 'accounts_primary_protected';
  end if;

  if tg_op = 'INSERT' then owner_ids := array[new.user_id];
  elsif tg_op = 'DELETE' then owner_ids := array[old.user_id];
  else owner_ids := array[old.user_id, new.user_id];
  end if;
  -- Сериализуем изменения счетов одного владельца также при прямой SQL-записи.
  perform id from public.users where id = any(owner_ids) order by id for update;

  if tg_op = 'DELETE' then
    if old.is_primary and exists (select 1 from public.users
      where id = old.user_id and login !~ '^deleted-[0-9a-f-]{36}$') then
      raise exception 'Основной счёт нельзя удалить'
        using errcode = '23514', constraint = 'accounts_primary_protected';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if old.is_primary and (new.user_id is distinct from old.user_id
      or new.id is distinct from old.id) then
      raise exception 'Нельзя изменить владельца или идентификатор основного счёта'
        using errcode = '23514', constraint = 'accounts_primary_protected';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_accounts_protect_primary on public.accounts;
create trigger trg_accounts_protect_primary before insert or update or delete on public.accounts
  for each row execute function public.protect_primary_account();
drop trigger if exists trg_accounts_prevent_truncate on public.accounts;
create trigger trg_accounts_prevent_truncate before truncate on public.accounts
  for each statement execute function public.protect_primary_account();

create or replace function public.assert_user_primary_account(target_user_id uuid)
returns void language plpgsql as $$
begin
  if exists (select 1 from public.users where id = target_user_id
    and login !~ '^deleted-[0-9a-f-]{36}$') then
    if (select count(*) from public.accounts
        where user_id = target_user_id and is_primary) <> 1
      or exists (select 1 from public.accounts
        where user_id = target_user_id and is_primary and is_closed) then
      raise exception 'У пользователя должен быть один открытый основной счёт'
        using errcode = '23514', constraint = 'accounts_primary_required';
    end if;
  end if;
end;
$$;

create or replace function public.check_user_primary_account()
returns trigger language plpgsql as $$
begin
  if tg_table_name = 'users' then
    perform public.assert_user_primary_account(new.id);
  else
    if tg_op <> 'INSERT' then perform public.assert_user_primary_account(old.user_id); end if;
    if tg_op <> 'DELETE' then perform public.assert_user_primary_account(new.user_id); end if;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_accounts_require_primary on public.accounts;
create constraint trigger trg_accounts_require_primary
  after insert or update or delete on public.accounts deferrable initially deferred
  for each row execute function public.check_user_primary_account();
drop trigger if exists trg_users_require_primary on public.users;
create constraint trigger trg_users_require_primary
  after insert or update on public.users deferrable initially deferred
  for each row execute function public.check_user_primary_account();

create or replace function public.create_user_primary_account()
returns trigger language plpgsql as $$
begin
  if new.login !~ '^deleted-[0-9a-f-]{36}$' then
    insert into public.accounts (user_id, name, is_primary)
    values (new.id, 'Основной счёт', true);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_users_create_primary_account on public.users;
create trigger trg_users_create_primary_account after insert on public.users
  for each row execute function public.create_user_primary_account();
-- Конец общего блока защиты счетов.
