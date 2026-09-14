-- Этап 2/8. После миграций 2026-09-13-accounts-01–99, до обновления API.
-- Разрешаем атомарную смену основного счёта и очистку при обезличивании.
-- Данные и балансы не исправляем автоматически: нарушения останавливают накат.
begin;
lock table public.users in share row exclusive mode;
lock table public.accounts in share row exclusive mode;

do $$
declare bad_users text;
begin
  select string_agg(u.id::text, ', ' order by u.id) into bad_users
  from public.users u
  where u.login !~ '^deleted-[0-9a-f-]{36}$'
    and ((select count(*) from public.accounts a where a.user_id = u.id and a.is_primary) <> 1
      or exists (select 1 from public.accounts a
        where a.user_id = u.id and a.is_primary and a.is_closed));
  if bad_users is not null then
    raise exception 'Нарушен инвариант основного счёта у пользователей: %', bad_users;
  end if;
end;
$$;

-- Начало общего блока защиты счетов (также в schema.sql).
create unique index if not exists accounts_one_primary_key
  on public.accounts (user_id) where is_primary;
alter table public.accounts drop constraint if exists accounts_primary_open_check;
alter table public.accounts add constraint accounts_primary_open_check
  check (not is_primary or not is_closed);

create or replace function public.protect_primary_account()
returns trigger language plpgsql as $$
declare owner_ids uuid[];
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'Нельзя очистить таблицу счетов'
      using errcode = '23514', constraint = 'accounts_primary_protected';
  end if;

  if tg_op = 'INSERT' then owner_ids := array[new.user_id];
  elsif tg_op = 'DELETE' then owner_ids := array[old.user_id];
  else owner_ids := array[old.user_id, new.user_id];
  end if;
  -- Сериализуем изменения счетов одного владельца также при прямой SQL-записи.
  perform id from public.users where id = any(owner_ids) order by id for update;

  if tg_op = 'DELETE' then
    if old.is_primary and exists (select 1 from public.users
      where id = old.user_id and login !~ '^deleted-[0-9a-f-]{36}$') then
      raise exception 'Основной счёт нельзя удалить'
        using errcode = '23514', constraint = 'accounts_primary_protected';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if old.is_primary and (new.user_id is distinct from old.user_id
      or new.id is distinct from old.id) then
      raise exception 'Нельзя изменить владельца или идентификатор основного счёта'
        using errcode = '23514', constraint = 'accounts_primary_protected';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_accounts_protect_primary on public.accounts;
create trigger trg_accounts_protect_primary before insert or update or delete on public.accounts
  for each row execute function public.protect_primary_account();
drop trigger if exists trg_accounts_prevent_truncate on public.accounts;
create trigger trg_accounts_prevent_truncate before truncate on public.accounts
  for each statement execute function public.protect_primary_account();

create or replace function public.assert_user_primary_account(target_user_id uuid)
returns void language plpgsql as $$
begin
  if exists (select 1 from public.users where id = target_user_id
    and login !~ '^deleted-[0-9a-f-]{36}$') then
    if (select count(*) from public.accounts
        where user_id = target_user_id and is_primary) <> 1
      or exists (select 1 from public.accounts
        where user_id = target_user_id and is_primary and is_closed) then
      raise exception 'У пользователя должен быть один открытый основной счёт'
        using errcode = '23514', constraint = 'accounts_primary_required';
    end if;
  end if;
end;
$$;

create or replace function public.check_user_primary_account()
returns trigger language plpgsql as $$
begin
  if tg_table_name = 'users' then
    perform public.assert_user_primary_account(new.id);
  else
    if tg_op <> 'INSERT' then perform public.assert_user_primary_account(old.user_id); end if;
    if tg_op <> 'DELETE' then perform public.assert_user_primary_account(new.user_id); end if;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_accounts_require_primary on public.accounts;
create constraint trigger trg_accounts_require_primary
  after insert or update or delete on public.accounts deferrable initially deferred
  for each row execute function public.check_user_primary_account();
drop trigger if exists trg_users_require_primary on public.users;
create constraint trigger trg_users_require_primary
  after insert or update on public.users deferrable initially deferred
  for each row execute function public.check_user_primary_account();

create or replace function public.create_user_primary_account()
returns trigger language plpgsql as $$
begin
  if new.login !~ '^deleted-[0-9a-f-]{36}$' then
    insert into public.accounts (user_id, name, is_primary)
    values (new.id, 'Основной счёт', true);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_users_create_primary_account on public.users;
create trigger trg_users_create_primary_account after insert on public.users
  for each row execute function public.create_user_primary_account();
-- Конец общего блока защиты счетов.

commit;
