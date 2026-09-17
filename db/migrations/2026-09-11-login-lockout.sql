-- Блокировка входа по счётчику неудач: 5 неверных паролей — запрет на 15 минут.
-- Применение: docker compose exec -T db psql -U mybudget -d mybudget -f - < db/migrations/2026-09-11-login-lockout.sql. Идемпотентно.

begin;

alter table public.users
  add column if not exists failed_login_attempts integer not null default 0;

alter table public.users
  add column if not exists locked_until timestamptz;

commit;
