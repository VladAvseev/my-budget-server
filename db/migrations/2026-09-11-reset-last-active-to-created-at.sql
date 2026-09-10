-- Инкрементальная миграция 2026-09-11 (4): сброс активности на дату регистрации.
--
-- При переносе базы пакетная вставка исторических операций дёргала триггер
-- trg_operations_last_active, и он переставил last_active_at всем пользователям,
-- у которых есть хотя бы одна операция, на дату прогона переноса. Настоящие
-- даты при этом нигде не сохранились, поэтому возвращаем нейтральное значение —
-- дату создания аккаунта. Дальше активность ведёт серверный middleware
-- (см. 2026-09-11-last-active-any-request.sql).
--
-- Применение (после 2026-09-11-last-active-any-request.sql) — см. server/AGENTS.md:
--   docker compose exec -T db psql -U mybudget -d mybudget -f - \
--     < db/migrations/2026-09-11-reset-last-active-to-created-at.sql
--
-- Идемпотентно: повторный запуск безвреден.

begin;

-- Единственное изменение users двигает updated_at через BEFORE-триггер
-- set_updated_at, поэтому на время правки отключаем его (нужен владелец
-- таблицы — пользователь mybudget из docker-compose).
alter table public.users disable trigger trg_users_updated_at;

update public.users
   set last_active_at = created_at;

alter table public.users enable trigger trg_users_updated_at;

commit;
