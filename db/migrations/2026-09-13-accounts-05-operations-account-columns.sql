-- Этап 1/8: переход к нескольким аккаунтам и переводам.
-- Шаг 5. Добавляем account_id у регулярных операций и from/to_account_id у переводов.
--
-- Существующие доход/расход/ежедневная операции привязываются к основному счёту
-- пользователя. Пока переводы ещё не созданы, оставляем переходный CHECK,
-- который допускает old и new типы.
begin;

alter table public.operations
  add column if not exists account_id uuid references public.accounts(id) on delete set null;

alter table public.operations
  add column if not exists from_account_id uuid references public.accounts(id) on delete set null;

alter table public.operations
  add column if not exists to_account_id uuid references public.accounts(id) on delete set null;

create index if not exists operations_account_id_idx
  on public.operations (account_id);

create index if not exists operations_from_account_id_idx
  on public.operations (from_account_id);

create index if not exists operations_to_account_id_idx
  on public.operations (to_account_id);

update public.operations o
set account_id = p.id
from public.accounts p
where p.user_id = o.user_id
  and p.is_primary
  and o.account_id is null
  and o.type in ('income', 'expense', 'daily');

alter table public.operations
  drop constraint if exists operations_type_check;

alter table public.operations
  add constraint operations_type_check
  check (type in ('income', 'expense', 'daily', 'savings', 'savings_out', 'transfer'));

commit;
