-- Удаляет колонки body и response_body из request_logs.
-- Применение: docker compose exec -T db psql -U mybudget -d mybudget -f - < db/migrations/2026-09-10-request-logs-drop-bodies.sql. Идемпотентно.

alter table public.request_logs drop column if exists body;
alter table public.request_logs drop column if exists response_body;
