-- Схема PostgreSQL для сервера my-budget.
-- Рассчитана на пустую базу. Выполнить целиком: psql -f schema.sql
--
-- Особенности схемы:
--   * аккаунт и профиль — одна таблица users (роль, стартовый баланс,
--     валюта, онбординг, отметка активности живут в ней же);
--   * доступ контролирует серверный слой (Express), политик уровня БД нет;
--   * внешние ключи с каскадным удалением; исключение — consent_log:
--     FK без каскада, журнал согласий переживает владельца (хранение >= 3 лет);
--   * перечисления ограничены CHECK-констрейнтами;
--   * operations.date — тип date;
--   * уникальность code отчёта в рамках пользователя enforced индексом.

-- ── Расширения ───────────────────────────────────────────────────────────────
create extension if not exists pgcrypto;  -- gen_random_uuid()
create extension if not exists citext;    -- регистронезависимый логин

-- ── Пользователи: аккаунт + профиль (JWT-авторизация на сервере) ─────────────
create table public.users (
  id uuid primary key default gen_random_uuid(),
  login citext not null unique,
  password_hash text not null,
  role text not null default 'user' check (role in ('user', 'admin')),
  start_balance numeric not null default 0,
  currency text,
  onboarded boolean not null default false,
  last_active_at timestamptz,  -- отмечает authMiddleware при авторизованных запросах
  failed_login_attempts integer not null default 0,  -- неудачные входы подряд (см. _auth/service.ts)
  locked_until timestamptz,    -- до этого момента вход в аккаунт запрещён (временный блок)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Refresh-токены (одна строка = активная сессия/устройство) ───────────────
create table public.refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  token_hash text not null unique,
  user_agent text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Отчёты (периоды бюджета) ────────────────────────────────────────────────
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null,
  code text not null default '',
  has_daily_expenses boolean not null default false,
  daily_budget numeric,
  period_start date,
  period_end date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Категории операций/накоплений ───────────────────────────────────────────
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  type text not null check (type in ('income', 'expense', 'savings')),
  name text not null,
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Операции ────────────────────────────────────────────────────────────────
create table public.operations (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  type text not null check (type in ('income', 'expense', 'savings', 'savings_out', 'daily')),
  amount numeric not null,
  category_id uuid references public.categories (id) on delete set null,
  description text,
  date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Накопления ──────────────────────────────────────────────────────────────
create table public.accumulations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  category_id uuid references public.categories (id) on delete set null,
  description text not null,
  amount numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Цели накоплений (одна на savings-категорию) ────────────────────────────
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  amount numeric not null check (amount > 0),
  target_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, category_id)
);

-- ── Лимиты категорий в отчёте ───────────────────────────────────────────────
create table public.category_limits (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  amount numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_id, category_id)
);

-- ── Индексы (по запросам из клиентских RPC + FK-колонки) ────────────────────
create index accumulations_category_id_idx on public.accumulations (category_id);
create index accumulations_user_id_created_at_idx on public.accumulations (user_id, created_at desc);
create index categories_user_id_type_idx on public.categories (user_id, type);
create index operations_category_id_idx on public.operations (category_id);
create index operations_report_type_created_at_idx on public.operations (report_id, type, created_at desc);
create index operations_user_id_idx on public.operations (user_id);
create index reports_user_id_created_at_idx on public.reports (user_id, created_at desc);
create index goals_category_id_idx on public.goals (category_id);
create index category_limits_category_id_idx on public.category_limits (category_id);
create index refresh_tokens_user_id_idx on public.refresh_tokens (user_id);
create index refresh_tokens_expires_at_idx on public.refresh_tokens (expires_at);
-- код периода уникален в рамках пользователя (пустой код не учитывается)
create unique index reports_user_id_code_key on public.reports (user_id, code) where code <> '';

-- ── Юридические документы (согласие на обработку ПДн и т.п.) ────────────────
-- Append-only реестр версий: строка опубликованной версии никогда не
-- редактируется (кроме осознанной косметической правки через CLI --cosmetic),
-- любое изменение текста — новая строка с новым version. content — Markdown,
-- HTML рендерит клиент (react-markdown). content_hash — sha256 от content;
-- несовпадение при выдаче = инцидент целостности (лог в _legal/service.ts).
-- Публикация — только src/scripts/publish-legal-document.ts (см. AGENTS.md).
create table public.legal_documents (
  id uuid primary key default gen_random_uuid(),
  document_type text not null,
  version text not null,                        -- '2026-09-12' (дата публикации)
  published_at timestamptz not null default now(),
  is_current boolean not null default false,
  content text not null,                        -- Markdown
  content_hash varchar(64) not null,            -- hex sha256(content)
  unique (document_type, version)
);

-- Ровно одна «текущая» версия на document_type — на уровне БД, а не только
-- в транзакции публикации.
create unique index legal_documents_current_key
  on public.legal_documents (document_type)
  where is_current;

-- ── Журнал согласий (append-only юридически значимых событий) ────────────────
-- Только вставка: UPDATE/DELETE строк не бывает; отзыв — новая строка
-- action='revoked', удаление (обезличивание) данных — строка action='erased'.
-- created_at проставляет сервер (DEFAULT now()), от клиента не принимается.
-- ip_address/user_agent — ПЕРСОНАЛЬНЫЕ ДАННЫЕ, лежат зашифрованными
-- pgp_sym_encrypt(armor): это сознательный пересмотр политики «IP не храним»
-- (см. 2026-09-12-drop-ip-columns.sql) ради юридической значимости согласия.
-- Ключ шифрования — env CONSENT_ENC_KEY; расшифровка только руками в psql
-- (dearmor + pgp_sym_decrypt), приложение IP не читает.
-- Строки journal-а живут не менее 3 лет после прекращения обработки, поэтому
-- FK на users(id) БЕЗ каскада: physical delete пользователя невозможен
-- (вместо него — обезличивание аккаунта, строка users остаётся).
create table public.consent_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users (id),
  ip_address text not null,                     -- pgp armored
  user_agent text,                              -- pgp armored или null
  document_type text not null,
  document_version text not null,
  form_id text not null check (form_id in ('registration', 'consent_gate', 'account_settings', 'admin')),
  action text not null check (action in ('granted', 'revoked', 'erased')),
  created_at timestamptz not null default now(),
  foreign key (document_type, document_version)
    references public.legal_documents (document_type, version)
);

create index idx_consent_log_user
  on public.consent_log (user_id, document_type, created_at desc);

-- ── Логи HTTP-запросов (просмотр — админка, метрики считаются SQL-ем) ──────
-- Пишет middleware requestLoggingMiddleware: метод, путь, статус, длительность,
-- автор — и текст ошибки для ответов с статусом >= 400. Параметры запроса
-- (query), тела запросов/ответов и User-Agent не хранятся: это основной объём
-- таблицы и светлые данные в БД. Устаревшие строки чистит сама middleware
-- (LOG_RETENTION_DAYS).
create table public.request_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  method text not null,
  path text not null,
  status smallint not null,
  duration_ms integer not null,
  -- Только для неудачных ответов: сообщение из envelope { error: { message } }.
  error text,
  user_id uuid references public.users (id) on delete set null,
  -- Роль автора из JWT на момент запроса ('user' | 'admin'); null — без авторизации
  -- или пользователь удалён (on delete set null обнуляет user_id, роль остаётся).
  user_role text check (user_role in ('user', 'admin')),
  -- Отделяет «запрос без авторизации» от «user_id обнулён каскадом»:
  -- пишется в момент запроса (requestLoggingMiddleware), не меняется ретроспективно.
  is_authenticated boolean not null default false
);

create index request_logs_created_at_idx on public.request_logs (created_at desc);
create index request_logs_status_created_at_idx on public.request_logs (status, created_at desc);
-- Фильтр «Логи» в админке по пользователю (GET /admin/logs?userId=)
create index request_logs_user_id_idx on public.request_logs (user_id, created_at desc);
-- Фильтр/группировка по роли автора (график логов audience='users')
create index request_logs_user_role_created_at_idx on public.request_logs (user_role, created_at desc);

-- ── Автообновление updated_at ───────────────────────────────────────────────
-- updated_at двигается только если изменилась хотя бы одна колонка, кроме
-- самого updated_at и last_active_at: отметка активности не должна менять
-- дату изменения профиля.
create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  if to_jsonb(new) - 'updated_at' - 'last_active_at'
     is distinct from
     to_jsonb(old) - 'updated_at' - 'last_active_at' then
    new.updated_at = now();
  end if;
  return new;
end;
$$;

create trigger trg_users_updated_at before update on public.users
  for each row execute function public.set_updated_at();
create trigger trg_refresh_tokens_updated_at before update on public.refresh_tokens
  for each row execute function public.set_updated_at();
create trigger trg_reports_updated_at before update on public.reports
  for each row execute function public.set_updated_at();
create trigger trg_categories_updated_at before update on public.categories
  for each row execute function public.set_updated_at();
create trigger trg_operations_updated_at before update on public.operations
  for each row execute function public.set_updated_at();
create trigger trg_accumulations_updated_at before update on public.accumulations
  for each row execute function public.set_updated_at();
create trigger trg_goals_updated_at before update on public.goals
  for each row execute function public.set_updated_at();
create trigger trg_category_limits_updated_at before update on public.category_limits
  for each row execute function public.set_updated_at();

-- ── Отметка активности ──────────────────────────────────────────────────────
-- Ставится приложением, а не схемой: middleware src/middlewares/authMiddleware.ts
-- обновляет users.last_active_at на каждом запросе с валидным access-токеном,
-- не чаще одного раза в 15 минут.
-- Триггера на вставку операций здесь нет сознательно: он переставлял
-- last_active_at на now() при любой пакетной загрузке исторических операций.
