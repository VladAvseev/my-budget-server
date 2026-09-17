-- Нормализация id в путях request_logs к виду :id.
-- Применение: docker compose exec -T db psql -U mybudget -d mybudget -f - < db/migrations/2026-09-10-request-logs-normalize-paths.sql. Идемпотентно.

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
