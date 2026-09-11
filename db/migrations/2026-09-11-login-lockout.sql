-- Инкрементальная миграция 2026-09-11 (5): временная блокировка входа по счётчику неудач.
--
-- per-IP rate-limit (/auth/login — 5 попыток за 15 минут) не сдерживает
-- распределённый ботнет, который перебирает пароли ОДНОГО аккаунта с сотен
-- адресов. Добавляем второй слой — счётчик неудач на аккаунт в БД: после
-- 5 подряд неверных паролей вход запрещён на 15 минут (логику чтения/записи
-- колонок см. в src/modules/_auth/service.ts и repository.ts).
--
-- Применение — см. server/AGENTS.md:
--   docker compose exec -T db psql -U mybudget -d mybudget -f - \
--     < db/migrations/2026-09-11-login-lockout.sql
--
-- Идемпотентно: add column if not exists; повторный запуск безвреден.

begin;

alter table public.users
  add column if not exists failed_login_attempts integer not null default 0;

alter table public.users
  add column if not exists locked_until timestamptz;

commit;
