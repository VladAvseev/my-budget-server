-- Шаг 7: удаляет накопления и savings-категории. Необратимо: перед применением выполнить db/backup.sh.
-- Порядок важен: карта — до категорий; лимиты удаляются каскадом.
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
