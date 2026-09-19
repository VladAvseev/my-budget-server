-- Перенос бюджетов с периодов на категории от 2026-09-19.
--
-- Удаляем таблицу category_limits (бюджеты периодов) без переноса данных —
-- так решено, восстановление не требуется. Взамен добавляем лимит прямо в
-- категории: limit_amount (бюджет для расходов, цель для доходов, один на
-- категорию, действует в каждом периоде) и флаг show_daily_limit (показывать
-- дневной остаток).
--
-- Применение — см. server/AGENTS.md:
--   docker compose exec -T db psql -U mybudget -d mybudget -f - \
--     < db/migrations/2026-09-19-category-limits-to-category.sql
--
-- Идемпотентно: проверки существования везде, повторный запуск безвреден.
-- На свежих БД из актуального schema.sql — no-op (таблицы нет, колонки есть).

begin;

-- 1. Удаляем бюджеты периодов.
drop trigger if exists trg_category_limits_updated_at on public.category_limits;
drop table if exists public.category_limits;
drop index if exists public.category_limits_category_id_idx;

-- 2. Лимит в категориях.
alter table public.categories
  add column if not exists limit_amount numeric;
alter table public.categories
  add column if not exists show_daily_limit boolean default false;

update public.categories
  set show_daily_limit = false
  where show_daily_limit is null;

alter table public.categories
  alter column show_daily_limit set not null;
alter table public.categories
  alter column show_daily_limit set default false;

-- Некорректные старые значения (если колонки уже существовали без чека).
update public.categories
  set limit_amount = null
  where limit_amount is not null and limit_amount <= 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'categories_limit_amount_check'
  ) then
    alter table public.categories
      add constraint categories_limit_amount_check
      check (limit_amount is null or limit_amount > 0);
  end if;
end;
$$;

commit;
