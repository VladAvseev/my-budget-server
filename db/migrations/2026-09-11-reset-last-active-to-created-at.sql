-- Сброс last_active_at на дату регистрации (created_at).
-- Применение после 2026-09-11-last-active-any-request.sql: docker compose exec -T db psql -U mybudget -d mybudget -f - < db/migrations/2026-09-11-reset-last-active-to-created-at.sql. Идемпотентно.

begin;

-- На время правки отключаем trg_users_updated_at (нужен владелец таблицы).
alter table public.users disable trigger trg_users_updated_at;

update public.users
   set last_active_at = created_at;

alter table public.users enable trigger trg_users_updated_at;

commit;
