-- Шаг 3: удаляет колонку users.start_balance. Необратимо: перед применением выполнить db/backup.sh.
begin;

alter table public.users
  drop column if exists start_balance;

commit;
