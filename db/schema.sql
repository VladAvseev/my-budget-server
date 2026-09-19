-- Схема БД my-budget (PostgreSQL 16): таблицы, ограничения, индексы, триггеры, функции.
-- Только на пустую базу (автостарт тома pgdata); живую догонять файлами db/migrations.

CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

-- Пользователи: вход по login (citext), хеш bcrypt, онбординг и блокировка.
CREATE TABLE IF NOT EXISTS public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    password_hash text NOT NULL,
    role text DEFAULT 'user'::text NOT NULL,
    currency text,
    onboarded boolean DEFAULT false NOT NULL,
    last_active_at timestamptz,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    failed_login_attempts integer DEFAULT 0 NOT NULL,
    locked_until timestamptz,
    login public.citext NOT NULL,
    CONSTRAINT users_login_key UNIQUE (login),
    CONSTRAINT users_role_check CHECK (role = ANY (ARRAY['user'::text, 'admin'::text]))
);

-- Категории: типы income/expense. Лимит один на категорию (бюджет для
-- расходов, цель для доходов), действует в каждом периоде; дневной остаток
-- показывается только при show_daily_limit.
CREATE TABLE IF NOT EXISTS public.categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    type text NOT NULL,
    name text NOT NULL,
    color text,
    limit_amount numeric,
    show_daily_limit boolean DEFAULT false NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT categories_type_check CHECK (type = ANY (ARRAY['income'::text, 'expense'::text])),
    CONSTRAINT categories_limit_amount_check CHECK (limit_amount IS NULL OR limit_amount > 0)
);

-- Аккаунты пользователя: основной счёт, накопления и отдельные кошельки.
-- Не более одного основного счёта обеспечивает частичный unique-индекс;
-- наличие открытого основного проверяет отложенный constraint-триггер.
CREATE TABLE IF NOT EXISTS public.accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    name text NOT NULL,
    color text,
    initial_balance numeric DEFAULT 0 NOT NULL,
    is_closed boolean DEFAULT false NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT accounts_primary_open_check CHECK (NOT is_primary OR NOT is_closed)
);

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

-- Операции: 'income'/'expense' (account_id + category_id) и 'transfer'
-- (from_account_id/to_account_id, category_id NULL). Бизнес-дата — date.
CREATE TABLE IF NOT EXISTS public.operations (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    type text NOT NULL,
    amount numeric NOT NULL,
    category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
    description text,
    date date,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
    from_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
    to_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
    CONSTRAINT operations_type_check CHECK (type = ANY (ARRAY['income'::text, 'expense'::text, 'transfer'::text]))
);

-- Активные сессии (refresh-токены, одноразовые с ротацией).
CREATE TABLE IF NOT EXISTS public.refresh_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    user_agent text,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);

-- Лог входящих запросов и ошибок (пишет requestLoggingMiddleware, смотрит админка).
-- Сегменты пути с id пишутся как :id; ошибки — по тексту, авторизованность — по is_authenticated.
CREATE TABLE IF NOT EXISTS public.request_logs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at timestamptz DEFAULT now() NOT NULL,
    method text NOT NULL,
    path text NOT NULL,
    status smallint NOT NULL,
    duration_ms integer NOT NULL,
    error text,
    user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
    is_authenticated boolean DEFAULT false NOT NULL,
    user_role text,
    CONSTRAINT request_logs_user_role_check CHECK (user_role = ANY (ARRAY['user'::text, 'admin'::text]))
);

-- Версионируемые тексты юридических документов (канон — БД, см. legal:publish).
CREATE TABLE IF NOT EXISTS public.legal_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    document_type text NOT NULL,
    version text NOT NULL,
    published_at timestamptz DEFAULT now() NOT NULL,
    is_current boolean DEFAULT false NOT NULL,
    content text NOT NULL,
    content_hash character varying(64) NOT NULL,
    CONSTRAINT legal_documents_document_type_version_key UNIQUE (document_type, version)
);

-- Append-only журнал согласий/отзывов/удалений. user_id — FK БЕЗ каскада:
-- журнал обязан пережить пользователя (удаление — обезличивание, см. _consent).
CREATE TABLE IF NOT EXISTS public.consent_log (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id),
    ip_address text NOT NULL,
    user_agent text,
    document_type text NOT NULL,
    document_version text NOT NULL,
    form_id text NOT NULL,
    action text NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT consent_log_action_check CHECK (action = ANY (ARRAY['granted'::text, 'revoked'::text, 'erased'::text])),
    CONSTRAINT consent_log_form_id_check CHECK (form_id = ANY (ARRAY['registration'::text, 'consent_gate'::text, 'account_settings'::text, 'admin'::text])),
    CONSTRAINT consent_log_document_type_document_version_fkey FOREIGN KEY (document_type, document_version)
        REFERENCES public.legal_documents(document_type, version)
);

-- Индексы.
CREATE UNIQUE INDEX IF NOT EXISTS accounts_one_primary_key ON public.accounts USING btree (user_id) WHERE is_primary;
CREATE INDEX IF NOT EXISTS accounts_user_id_idx ON public.accounts USING btree (user_id);
CREATE INDEX IF NOT EXISTS categories_user_id_type_idx ON public.categories USING btree (user_id, type);
CREATE INDEX IF NOT EXISTS goals_user_id_idx ON public.goals USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_consent_log_user ON public.consent_log USING btree (user_id, document_type, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS legal_documents_current_key ON public.legal_documents USING btree (document_type) WHERE is_current;
CREATE INDEX IF NOT EXISTS operations_account_id_idx ON public.operations USING btree (account_id);
CREATE INDEX IF NOT EXISTS operations_category_id_idx ON public.operations USING btree (category_id);
CREATE INDEX IF NOT EXISTS operations_from_account_id_idx ON public.operations USING btree (from_account_id);
CREATE INDEX IF NOT EXISTS operations_to_account_id_idx ON public.operations USING btree (to_account_id);
CREATE INDEX IF NOT EXISTS operations_user_id_idx ON public.operations USING btree (user_id);
CREATE INDEX IF NOT EXISTS refresh_tokens_expires_at_idx ON public.refresh_tokens USING btree (expires_at);
CREATE INDEX IF NOT EXISTS refresh_tokens_user_id_idx ON public.refresh_tokens USING btree (user_id);
CREATE INDEX IF NOT EXISTS request_logs_created_at_idx ON public.request_logs USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS request_logs_status_created_at_idx ON public.request_logs USING btree (status, created_at DESC);
CREATE INDEX IF NOT EXISTS request_logs_user_id_idx ON public.request_logs USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS request_logs_user_role_created_at_idx ON public.request_logs USING btree (user_role, created_at DESC);

-- Функции.
CREATE OR REPLACE FUNCTION public.assert_user_primary_account(target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $_$
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
$_$;

CREATE OR REPLACE FUNCTION public.check_user_primary_account()
RETURNS trigger
LANGUAGE plpgsql
AS $$
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

CREATE OR REPLACE FUNCTION public.create_user_primary_account()
RETURNS trigger
LANGUAGE plpgsql
AS $_$
begin
  if new.login !~ '^deleted-[0-9a-f-]{36}$' then
    insert into public.accounts (user_id, name, is_primary)
    values (new.id, 'Основной счёт', true);
  end if;
  return new;
end;
$_$;

CREATE OR REPLACE FUNCTION public.protect_primary_account()
RETURNS trigger
LANGUAGE plpgsql
AS $_$
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
$_$;

-- Функция триггером не вызывается.
CREATE OR REPLACE FUNCTION public.seed_default_categories_for_user()
RETURNS trigger
LANGUAGE plpgsql
AS $$
begin
  insert into public.categories (user_id, name, type, icon, color)
  values
    (new.id, 'Зарплата', 'income', '💼', '#4CAF50'),
    (new.id, 'Фриланс', 'income', '💻', '#8BC34A'),
    (new.id, 'Подарки', 'income', '🎁', '#FF9800'),
    (new.id, 'Продукты', 'expense', '🛒', '#2196F3'),
    (new.id, 'Транспорт', 'expense', '🚌', '#9C27B0'),
    (new.id, 'Развлечения', 'expense', '🎮', '#E91E63'),
    (new.id, 'Кафе и рестораны', 'expense', '🍽️', '#FF5722'),
    (new.id, 'Жильё', 'expense', '🏠', '#795548'),
    (new.id, 'Здоровье', 'expense', '💊', '#00BCD4')
  on conflict do nothing;

  return new;
end;
$$;

-- updated_at — только при реальном изменении данных.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
begin
  if to_jsonb(new) - 'updated_at' - 'last_active_at'
     is distinct from
     to_jsonb(old) - 'updated_at' - 'last_active_at' then
    new.updated_at = now();
  end if;
  return new;
end;
$$;

-- Триггеры (у goals триггеров нет).
DROP TRIGGER IF EXISTS trg_accounts_prevent_truncate ON public.accounts;
CREATE TRIGGER trg_accounts_prevent_truncate BEFORE TRUNCATE ON public.accounts FOR EACH STATEMENT EXECUTE FUNCTION public.protect_primary_account();

DROP TRIGGER IF EXISTS trg_accounts_protect_primary ON public.accounts;
CREATE TRIGGER trg_accounts_protect_primary BEFORE INSERT OR DELETE OR UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.protect_primary_account();

DROP TRIGGER IF EXISTS trg_accounts_require_primary ON public.accounts;
CREATE CONSTRAINT TRIGGER trg_accounts_require_primary AFTER INSERT OR DELETE OR UPDATE ON public.accounts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_user_primary_account();

DROP TRIGGER IF EXISTS trg_accounts_updated_at ON public.accounts;
CREATE TRIGGER trg_accounts_updated_at BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_categories_updated_at ON public.categories;
CREATE TRIGGER trg_categories_updated_at BEFORE UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_operations_updated_at ON public.operations;
CREATE TRIGGER trg_operations_updated_at BEFORE UPDATE ON public.operations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_refresh_tokens_updated_at ON public.refresh_tokens;
CREATE TRIGGER trg_refresh_tokens_updated_at BEFORE UPDATE ON public.refresh_tokens FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_users_create_primary_account ON public.users;
CREATE TRIGGER trg_users_create_primary_account AFTER INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION public.create_user_primary_account();

DROP TRIGGER IF EXISTS trg_users_require_primary ON public.users;
CREATE CONSTRAINT TRIGGER trg_users_require_primary AFTER INSERT OR UPDATE ON public.users DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_user_primary_account();

DROP TRIGGER IF EXISTS trg_users_updated_at ON public.users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Row Level Security не включаем: доступ к данным контролируется сервером через
-- user_id в каждом запросе.
