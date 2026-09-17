-- Удаляет колонки ip из request_logs и refresh_tokens.
-- Применение: docker compose exec -T db psql -U mybudget -d mybudget -f - < db/migrations/2026-09-12-drop-ip-columns.sql. Идемпотентно.

alter table public.request_logs drop column if exists ip;
alter table public.refresh_tokens drop column if exists ip;
