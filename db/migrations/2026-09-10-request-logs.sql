-- Логи HTTP-запросов + атрибуция автора.
-- Применение: docker compose exec db psql -U mybudget -d mybudget, вставить текст. Идемпотентно.

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

-- Догоняет базы без новой колонки.
alter table public.request_logs add column if not exists is_authenticated boolean not null default false;

-- Строки с user_id считаем авторизованными.
update public.request_logs
   set is_authenticated = true
 where user_id is not null
   and is_authenticated = false;

create index if not exists request_logs_created_at_idx on public.request_logs (created_at desc);
create index if not exists request_logs_status_created_at_idx on public.request_logs (status, created_at desc);
-- Фильтр «Логи» в админке по пользователю (GET /admin/logs?userId=)
create index if not exists request_logs_user_id_idx on public.request_logs (user_id, created_at desc);

-- ── Функция автообновления updated_at ────────────────────────────────────────
-- Пересоздаёт set_updated_at (create or replace безопасен).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
