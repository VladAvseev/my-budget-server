-- Шаг 2: основной счёт пользователям без primary-аккаунта. Идемпотентно.
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
