-- Этап 1/8: переход к нескольким аккаунтам и переводам.
-- Шаг 4. Переносим накопления и остатки savings/savings_out в отдельные accounts.
--
-- Для каждой пары (user_id, category_id) из accumulations и savings-операций создаётся счёт:
--   * name = name категории или 'Накопления без категории' для NULL;
--   * initial_balance = сумма accumulations.amount для группы;
--   * is_closed = false, is_primary = false.
--
-- Идемпотентность: соответствия хранятся в служебной таблице
-- public.migration_savings_accounts_map, существующие группы не повторяются.
begin;

create table if not exists public.migration_savings_accounts_map (
  user_id uuid not null references public.users(id) on delete cascade,
  category_id uuid references public.categories(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade
);

-- category_id может быть NULL для накоплений без категории.
create unique index if not exists migration_savings_accounts_map_user_category_key
  on public.migration_savings_accounts_map (user_id, category_id) nulls not distinct;

drop table if exists public.migration_savings_account_seed;
create table public.migration_savings_account_seed (
  user_id uuid not null,
  category_id uuid,
  account_name text not null,
  initial_balance numeric not null,
  account_id uuid primary key default gen_random_uuid()
);

insert into public.migration_savings_account_seed (
  user_id,
  category_id,
  account_name,
  initial_balance,
  account_id
)
select
  g.user_id,
  g.category_id,
  coalesce(c.name, 'Накопления без категории'),
  coalesce(s.total, 0)::numeric,
  gen_random_uuid()
from (
  select user_id, category_id
  from public.accumulations
  group by user_id, category_id

  union

  select user_id, category_id
  from public.operations
  where type in ('savings', 'savings_out')
  group by user_id, category_id
) g
left join (
  select user_id, category_id, sum(amount)::numeric total
  from public.accumulations
  group by user_id, category_id
) s
  on s.user_id = g.user_id
 and s.category_id is not distinct from g.category_id
left join public.categories c
  on c.id = g.category_id
where not exists (
  select 1
  from public.migration_savings_accounts_map m
  where m.user_id = g.user_id
    and m.category_id is not distinct from g.category_id
);

insert into public.accounts (id, user_id, name, initial_balance, is_closed, is_primary)
select
  account_id,
  user_id,
  account_name,
  initial_balance,
  false,
  false
from public.migration_savings_account_seed;

insert into public.migration_savings_accounts_map (user_id, category_id, account_id)
select user_id, category_id, account_id
from public.migration_savings_account_seed;

drop table public.migration_savings_account_seed;

commit;
