-- Инкрементальная миграция 2026-09-10: логи HTTP-запросов + атрибуция автора.
--
-- Боевая БД на сервере создана более старой версией db/schema.sql, а схема
-- применяется автоматически только при ПЕРВОМ старте тома pgdata — поэтому
-- изменения схемы догоняются этим файлом вручную (см. server/AGENTS.md):
--   docker compose exec db psql -U mybudget -d mybudget   → вставить текст ниже
--
-- Идемпотентно: можно выполнять повторно и поверх уже обновлённой базы.

-- ── Логи HTTP-запросов ───────────────────────────────────────────────────────
-- Пишет requestLoggingMiddleware; user_id = автор запроса, is_authenticated
-- отличает «без авторизации» от «user_id обнулён каскадом при удалении юзера».
create table if not exists public.request_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  method text not null,
  path text not null,
  query jsonb,
  body jsonb,
  status smallint not null,
  duration_ms integer not null,
  response_body jsonb,
  error text,
  user_id uuid references public.users (id) on delete set null,
  is_authenticated boolean not null default false,
  ip inet,
  user_agent text
);

-- Для баз, где request_logs уже создана ранней версией схемы без новой колонки.
alter table public.request_logs add column if not exists is_authenticated boolean not null default false;

-- Строки, записанные до появления колонки, считаем авторизованными, если у них
-- есть user_id (на свежей базе строк нет — update ничего не меняет).
update public.request_logs
   set is_authenticated = true
 where user_id is not null
   and is_authenticated = false;

create index if not exists request_logs_created_at_idx on public.request_logs (created_at desc);
create index if not exists request_logs_status_created_at_idx on public.request_logs (status, created_at desc);
-- Фильтр «Логи» в админке по пользователю (GET /admin/logs?userId=)
create index if not exists request_logs_user_id_idx on public.request_logs (user_id, created_at desc);

-- ── Функция автообновления updated_at ────────────────────────────────────────
-- Коммит «логирование» случайно стёр create function public.set_updated_at()
-- из schema.sql: база, инициализированная той версией, осталась без функции,
-- а триггеры trg_*_updated_at на неё ссылаются. create or replace безопасно
-- пересоздаёт функцию в любой базе.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
