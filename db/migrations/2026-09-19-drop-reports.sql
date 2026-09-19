-- Удаление таблицы public.reports и связей operations.report_id от 2026-09-19.
--
-- Контекст: календарные периоды-отчёты больше не используются, операции живут
-- сами по себе (бизнес-дата — operations.date). Данные сохранять не нужно,
-- строки reports и связь удаляются вместе.
-- Здесь догоняем живые БД до состояния без reports. Свежие установки идут
-- через обновлённый db/schema.sql (там CREATE TABLE reports, колонка
-- operations.report_id, связанные индексы и триггер уже удалены).
--
-- Применение — см. server/AGENTS.md:
--   docker compose exec -T db psql -U mybudget -d mybudget -f - \
--     < db/migrations/2026-09-19-drop-reports.sql
--
-- Идемпотентно: IF EXISTS и DO-блоки везде, повторный запуск безвреден.
-- Порядок: снять FK → снять зависимый индекс operations →
-- дропнуть колонку report_id → дропнуть reports (+ её триггер/индексы).

begin;

-- 1. FK operations.report_id -> reports.id: снимаем любой FK по колонке,
--    затем страховочно по каноническому имени (слепок давал именно его).
do $$
declare
  v_conname text;
begin
  for v_conname in
    select c.conname
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      join pg_attribute a on a.attrelid = t.oid and a.attnum = c.conkey[1]
     where n.nspname = 'public'
       and t.relname = 'operations'
       and c.contype = 'f'
       and a.attname = 'report_id'
  loop
    execute format('alter table public.operations drop constraint %I', v_conname);
  end loop;
end;
$$;

alter table public.operations drop constraint if exists operations_report_id_fkey;

-- 2. Зависимый индекс на operations.
drop index if exists public.operations_report_type_created_at_idx;

-- 3. Колонка-связь.
alter table public.operations drop column if exists report_id;

-- 4. Триггер updated_at на reports (guard: DROP TRIGGER падает,
--    если самой таблицы уже нет).
do $$
begin
  if exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'reports'
  ) then
    execute 'drop trigger if exists trg_reports_updated_at on public.reports';
  end if;
end;
$$;

drop index if exists public.reports_user_id_code_key;
drop index if exists public.reports_user_id_created_at_idx;
drop table if exists public.reports;

commit;
