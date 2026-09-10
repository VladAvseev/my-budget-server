-- Инкрементальная миграция 2026-09-10 (2): отказ от хранения тел запросов/ответов.
--
-- Тела (body, response_body) занимали основной объём request_logs, поэтому
-- middleware перестал их писать, а колонки удаляются вместе с накопленными
-- данными. Применение — см. server/AGENTS.md:
--   docker compose exec db psql -U mybudget -d mybudget -f - < db/migrations/2026-09-10-request-logs-drop-bodies.sql
--
-- Идемпотентно: можно выполнять повторно и поверх уже обновлённой базы.

alter table public.request_logs drop column if exists body;
alter table public.request_logs drop column if exists response_body;
