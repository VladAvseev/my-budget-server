-- Инкрементальная миграция 2026-09-12: отказ от хранения IP-адресов.
--
-- Из системы логирования и из метаданных сессий убрано отслеживание и сохранение
-- IP: middleware больше не пишет req.ip в request_logs, а auth-слой — в
-- refresh_tokens. Колонки удаляются вместе с накопленными адресами. Rate-limit
-- по IP (express-rate-limit) при этом не затрагивается: он использует адрес лишь
-- как ключ счётчика в памяти и в БД ничего не хранит.
--
-- Применение — см. server/AGENTS.md:
--   docker compose exec db psql -U mybudget -d mybudget -f - < db/migrations/2026-09-12-drop-ip-columns.sql
--
-- Идемпотентно: можно выполнять повторно и поверх уже обновлённой базы.

alter table public.request_logs drop column if exists ip;
alter table public.refresh_tokens drop column if exists ip;
