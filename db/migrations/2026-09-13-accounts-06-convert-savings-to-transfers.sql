-- Шаг 6: savings/savings_out — в переводы между счетами.
-- Дата, сумма и description сохраняются, category_id обнуляется.
begin;

update public.operations o
set
  type = 'transfer',
  from_account_id = p.id,
  to_account_id = m.account_id,
  account_id = null,
  category_id = null
from public.accounts p,
     public.migration_savings_accounts_map m
where p.user_id = o.user_id
  and p.is_primary
  and m.user_id = o.user_id
  and m.category_id is not distinct from o.category_id
  and o.type = 'savings';

update public.operations o
set
  type = 'transfer',
  from_account_id = m.account_id,
  to_account_id = p.id,
  account_id = null,
  category_id = null
from public.accounts p,
     public.migration_savings_accounts_map m
where p.user_id = o.user_id
  and p.is_primary
  and m.user_id = o.user_id
  and m.category_id is not distinct from o.category_id
  and o.type = 'savings_out';

do $$
begin
  if exists (
    select 1
    from public.operations
    where type in ('savings', 'savings_out')
  ) then
    raise exception 'Этап 1/8 не завершён: остались savings/savings_out без соответствующего аккаунта в public.migration_savings_accounts_map';
  end if;
end;
$$;

alter table public.operations
  drop constraint if exists operations_type_check;

alter table public.operations
  add constraint operations_type_check
  check (type in ('income', 'expense', 'daily', 'transfer'));

commit;
