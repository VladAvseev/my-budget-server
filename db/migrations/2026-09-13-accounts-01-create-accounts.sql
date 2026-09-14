-- Этап 1/8: переход к нескольким аккаунтам и переводам.
-- Шаг 1. Создаём accounts, защищаем основной счёт и сохраняем денежный снимок.
-- Основной счёт существующих пользователей заполняется уже здесь, чтобы после
-- COMMIT не оставалось пользователей без счёта. Шаг 2 пропустит эти строки.
--
-- Идемпотентность:
--   * объекты создаются через if not exists;
--   * снимок заполняется только для пользователей, которых в нём ещё нет,
--     чтобы повторный прогон после частичных изменений не пересчитывал «до».
begin;

-- Не допускаем регистрацию и изменение исходных балансов между бэкфиллом
-- и установкой триггера создания основного счёта.
lock table public.users in share row exclusive mode;

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  initial_balance numeric not null default 0,
  is_closed boolean not null default false,
  is_primary boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

-- Не более одного основного счёта на пользователя.
-- Ограничение сделано частичным уникальным индексом, а не FK users.primary_account_id,
-- чтобы users не ссылался на accounts и не возникало циклической зависимости.
create unique index if not exists accounts_one_primary_key
  on public.accounts (user_id)
  where is_primary;

create index if not exists accounts_user_id_idx
  on public.accounts (user_id);

-- CHECK действует и при INSERT, и при UPDATE; существующие нарушения вызывают
-- откат миграции, а не молчаливое изменение состояния счетов.
alter table public.accounts
  drop constraint if exists accounts_primary_open_check;
alter table public.accounts
  add constraint accounts_primary_open_check check (not is_primary or not is_closed);

create or replace function public.protect_primary_account()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'Нельзя очистить таблицу счетов: пользователи останутся без основного счёта'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    -- При физическом удалении самого пользователя сохраняем ON DELETE CASCADE.
    -- Пока пользователь существует, его основной счёт удалить нельзя.
    if old.is_primary and exists (select 1 from public.users where id = old.user_id) then
      raise exception 'Основной счёт нельзя удалить'
        using errcode = '23514';
    end if;
    return old;
  end if;

  -- Иначе запрет удаления можно было бы обойти снятием флага или сменой владельца.
  if old.is_primary and (
    new.is_primary is distinct from true
    or new.user_id is distinct from old.user_id
    or new.id is distinct from old.id
  ) then
    raise exception 'Нельзя изменить основной статус, владельца или идентификатор основного счёта'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_accounts_protect_primary on public.accounts;
create trigger trg_accounts_protect_primary
  before update or delete on public.accounts
  for each row execute function public.protect_primary_account();

drop trigger if exists trg_accounts_prevent_truncate on public.accounts;
create trigger trg_accounts_prevent_truncate
  before truncate on public.accounts
  for each statement execute function public.protect_primary_account();

-- Сохраняем прежний начальный баланс; NULL становится 0, как в шаге 2.
-- Уже существующие основные счета не перезаписываем.
insert into public.accounts (user_id, name, initial_balance, is_closed, is_primary)
select u.id, 'Основной счёт', coalesce(u.start_balance, 0)::numeric, false, true
from public.users u
where not exists (
  select 1 from public.accounts a where a.user_id = u.id and a.is_primary
);

-- Новый пользователь сразу получает открытый основной счёт с нулевым балансом.
-- Вставка счёта выполняется в той же транзакции: если она не удалась,
-- пользователь тоже не создаётся. Бэкенду не нужно повторно вставлять primary.
-- Функция не зависит от start_balance, удаляемого в шаге 3.
create or replace function public.create_user_primary_account()
returns trigger
language plpgsql
as $$
begin
  insert into public.accounts (user_id, name, is_primary)
  values (new.id, 'Основной счёт', true);
  return new;
end;
$$;

drop trigger if exists trg_users_create_primary_account on public.users;
create trigger trg_users_create_primary_account
  after insert on public.users
  for each row execute function public.create_user_primary_account();

drop trigger if exists trg_accounts_updated_at on public.accounts;
create trigger trg_accounts_updated_at
  before update on public.accounts
  for each row execute function public.set_updated_at();

-- Временная таблица проверки. Хранит сумму, которая должна сохраниться:
-- start_balance + доход - расход - ежедневная + накопления.
create table if not exists public.migration_accounts_snapshot (
  user_id uuid primary key references public.users(id) on delete cascade,
  expected_total numeric not null
);

insert into public.migration_accounts_snapshot (user_id, expected_total)
select
  u.id,
  (
    coalesce(u.start_balance, 0)
    + coalesce((select sum(o.amount) from public.operations o where o.user_id = u.id and o.type = 'income'), 0)
    - coalesce((select sum(o.amount) from public.operations o where o.user_id = u.id and o.type = 'expense'), 0)
    - coalesce((select sum(o.amount) from public.operations o where o.user_id = u.id and o.type = 'daily'), 0)
    + coalesce((select sum(a.amount) from public.accumulations a where a.user_id = u.id), 0)
  )::numeric
from public.users u
where not exists (
  select 1 from public.migration_accounts_snapshot s where s.user_id = u.id
);

commit;
