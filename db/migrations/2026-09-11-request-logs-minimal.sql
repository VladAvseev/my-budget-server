-- Удаляет колонки query и user_agent из request_logs.
-- Применение: docker compose exec -T db psql -U mybudget -d mybudget -f - < db/migrations/2026-09-11-request-logs-minimal.sql. Идемпотентно; VACUUM последним отдельно.

alter table public.request_logs drop column if exists query;
alter table public.request_logs drop column if exists user_agent;

-- Переписывает таблицу для возврата диска; на время операции логи не пишутся.
vacuum full public.request_logs;
