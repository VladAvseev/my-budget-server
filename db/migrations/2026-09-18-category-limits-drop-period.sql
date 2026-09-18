-- Удаление колонки period из category_limits от 2026-09-18.
--
-- Колонка period (week/month/quarter/year) досталась живым БД от слепка старого
-- бэкенда: коммит 608f12d убрал её из schema.sql, а код её никогда не писал
-- (INSERT в replaceCategoryLimits — только report_id/category_id/user_id/amount).
-- Но schema.sql состоит из CREATE TABLE IF NOT EXISTS и существующие тома pgdata
-- не чинит. Итог — PUT /reports/:id/category-limits падал с 23502
-- «null value in column "period" violates not-null constraint».
-- Заодно догоняем UNIQUE (report_id, category_id) и индекс по category_id из того
-- же коммита — их на живых БД тоже нет. Гранулярность period не нужна: лимит и так
-- привязан к отчёту (report_id), клиент и тип CategoryLimit её не знают.
--
-- Применение — см. server/AGENTS.md:
--   docker compose exec -T db psql -U mybudget -d mybudget -f - \
--     < db/migrations/2026-09-18-category-limits-drop-period.sql
--
-- Идемпотентно: проверки существования везде, повторный запуск безвреден.
-- На свежих БД из актуального schema.sql — no-op.

begin;

-- Контроль: дубликатов (report_id, category_id) быть не должно, иначе unique не встанет.
do $$
begin
  if exists (
    select 1 from public.category_limits
    group by report_id, category_id
    having count(*) > 1
  ) then
    raise exception 'дубликаты category_limits (report_id, category_id): разберите вручную до применения миграции';
  end if;
end;
$$;

alter table public.category_limits drop constraint if exists category_limits_period_check;
alter table public.category_limits drop column if exists period;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'category_limits_report_id_category_id_key'
  ) then
    alter table public.category_limits
      add constraint category_limits_report_id_category_id_key unique (report_id, category_id);
  end if;
end;
$$;

create index if not exists category_limits_category_id_idx
  on public.category_limits using btree (category_id);

commit;
