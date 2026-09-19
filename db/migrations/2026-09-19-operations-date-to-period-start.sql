-- Всем операциям выставить date = дате начала периода (reports.period_start).
--
-- Бизнес-дата операции — public.operations.date, период — public.reports.period_start,
-- связь — operations.report_id -> reports.id.
--
-- Применение — см. server/AGENTS.md:
--   docker compose exec -T db psql -U mybudget -d mybudget -f - \
--     < db/migrations/2026-09-19-operations-date-to-period-start.sql
--
-- Идемпотентно: повторный запуск ставит те же значения, безвреден.
-- Триггер trg_operations_updated_at специально не глушится: updated_at честно
-- поднимается на now() как след правки.

begin;

-- Контроль до правки.
select count(*) as total_operations from public.operations;
select count(*) as distinct_from_period_start
  from public.operations as o
  join public.reports as r on r.id = o.report_id
  where o.date is distinct from r.period_start;
select count(*) as null_period_start
  from public.operations as o
  join public.reports as r on r.id = o.report_id
  where r.period_start is null;

-- Стоп-кран по NULL: period_start nullable, молча ничего не пропускаем,
-- вся транзакция откатывается исключением.
do $$
declare
  v_bad integer;
begin
  select count(*) into v_bad
    from public.operations as o
    join public.reports as r on r.id = o.report_id
    where r.period_start is null;
  if v_bad > 0 then
    raise exception 'Стоп: % операций с reports.period_start IS NULL, date выставлять не во что. Миграция прервана, ничего не изменено.', v_bad;
  end if;
end;
$$;

-- Основная правка: всем строкам без фильтра по отличиям.
update public.operations as o
  set date = r.period_start
  from public.reports as r
  where r.id = o.report_id;

-- Контроль после правки.
select count(*) as total_operations from public.operations;
select count(*) as distinct_from_period_start
  from public.operations as o
  join public.reports as r on r.id = o.report_id
  where o.date is distinct from r.period_start;
select count(*) as null_period_start
  from public.operations as o
  join public.reports as r on r.id = o.report_id
  where r.period_start is null;

commit;
