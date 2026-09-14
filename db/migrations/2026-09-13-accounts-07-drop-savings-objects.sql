-- Этап 1/8: переход к нескольким аккаунтам и переводам.
-- Шаг 7. Удаляем старые сущности накоплений, savings-категории и служебный маппинг.
--
-- НЕОБРАТИМОЕ ИЗМЕНЕНИЕ.
-- Перед применением на боевой БД обязательно выполнить:
--   db/backup.sh
--
-- Порядок:
--   1) удаляем goals и accumulations;
--   2) удаляем служебную карту, чтобы не зависеть от каскадов по categories;
--   3) удаляем savings-категории; category_limits удаляются каскадно FK на categories;
--   4) переживляем CHECK categories без savings.
begin;

drop table if exists public.goals;
drop table if exists public.accumulations;
drop table if exists public.migration_savings_accounts_map;

delete from public.categories
where type = 'savings';

alter table public.categories
  drop constraint if exists categories_type_check;

alter table public.categories
  add constraint categories_type_check
  check (type = any (array['income', 'expense', 'daily']::text[]));

commit;
