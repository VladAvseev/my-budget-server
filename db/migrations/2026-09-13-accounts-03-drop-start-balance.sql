-- Этап 1/8: переход к нескольким аккаунтам и переводам.
-- Шаг 3. Удаляем users.start_balance.
--
-- НЕОБРАТИМОЕ ИЗМЕНЕНИЕ.
-- Перед применением на боевой БД обязательно выполнить:
--   db/backup.sh
--
-- Деньги уже сохранены в accounts (шаг 2) и зафиксированы для проверки
-- в public.migration_accounts_snapshot (шаг 1).
begin;

alter table public.users
  drop column if exists start_balance;

commit;
