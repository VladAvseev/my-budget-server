-- Инкрементальная миграция 2026-09-10 (3): нормализация id в путях request_logs.
--
-- requestLoggingMiddleware теперь пишет путь с ':id' вместо фактических
-- UUID/числовых сегментов (/api/v1/reports/123 -> /api/v1/reports/:id),
-- иначе метрики топов в админке группировали бы каждый id отдельно.
-- Этот файл приводит уже накопленные строки к тому же виду.
-- Применение — см. server/AGENTS.md:
--   docker compose exec db psql -U mybudget -d mybudget -f - < db/migrations/2026-09-10-request-logs-normalize-paths.sql
--
-- Идемпотентно: ':id' не совпадает с паттернами, повторный прогон ничего не меняет.

-- UUID-сегменты (все id ресурсов в схеме — uuid).
update public.request_logs
   set path = regexp_replace(
     path,
     '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(/|$)',
     '/:id\1',
     'gi'
   )
 where path ~ '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(/|$)';

-- Чисто числовые сегменты (защита на будущее: bigint-id маршруты).
update public.request_logs
   set path = regexp_replace(path, '/[0-9]+(/|$)', '/:id\1', 'g')
 where path ~ '/[0-9]+(/|$)';
