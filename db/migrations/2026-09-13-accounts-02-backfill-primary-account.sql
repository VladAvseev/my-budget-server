-- Этап 1/8: переход к нескольким аккаунтам и переводам.
-- Шаг 2. Создаём для существующих пользователей основной счёт и переносим в него start_balance.
--
-- Идемпотентность: вставляем только для пользователей, у которых ещё нет primary-аккаунта.
begin;

insert into public.accounts (user_id, name, initial_balance, is_closed, is_primary)
select
  u.id,
  'Основной счёт',
  coalesce(u.start_balance, 0)::numeric,
  false,
  true
from public.users u
where not exists (
  select 1
  from public.accounts a
  where a.user_id = u.id
    and a.is_primary
);

commit;
