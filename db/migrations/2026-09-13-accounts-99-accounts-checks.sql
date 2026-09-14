-- Этап 1/8: переход к нескольким аккаунтам и переводам.
-- Шаг 8. Проверка целостности после миграций 01–07.
--
-- Файл должен выполняться в транзакции. Если хотя бы одна проверка падает,
-- транзакция откатывается и служебный снимок public.migration_accounts_snapshot
-- остаётся для разбора данных.
--
-- При успешной проверке снимок удаляется в конце файла.
begin;

do $$
begin
  if to_regclass('public.accounts') is null then
    raise exception 'Проверка 1/8 не пройдена: таблица public.accounts отсутствует';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'users'
      and column_name = 'start_balance'
  ) then
    raise exception 'Проверка 1/8 не пройдена: public.users.start_balance ещё существует';
  end if;

  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'operations'
      and column_name in ('account_id', 'from_account_id', 'to_account_id')
  ) <> 3 then
    raise exception 'Проверка 1/8 не пройдена: у public.operations отсутствуют account/from/to-колонки';
  end if;

  if to_regclass('public.accumulations') is not null then
    raise exception 'Проверка 1/8 не пройдена: таблица public.accumulations ещё существует';
  end if;

  if to_regclass('public.goals') is not null then
    raise exception 'Проверка 1/8 не пройдена: таблица public.goals ещё существует';
  end if;

  if to_regclass('public.migration_savings_accounts_map') is not null then
    raise exception 'Проверка 1/8 не пройдена: служебная таблица public.migration_savings_accounts_map ещё существует';
  end if;
end;
$$;

-- Проверка инварианта денег:
--   expected_total = start_balance + income - expense - daily + accumulations
--   actual_total   = Σ initial_balance всех accounts + income - expense - daily
-- Переводы нейтральны на глобальном уровне, поэтому в sum() не участвуют.
do $$
declare
  v_bad text;
begin
  if to_regclass('public.migration_accounts_snapshot') is null then
    raise exception 'Проверка инварианта не пройдена: public.migration_accounts_snapshot отсутствует. Прогоните миграции 01–07 до этой проверки.';
  end if;

  select string_agg(
      q.user_id::text || ': expected=' || q.expected_total::text || ', actual=' || q.actual_total::text,
      E'\n'
    )
    into v_bad
  from (
    select
      s.user_id,
      s.expected_total,
      (
        coalesce((select sum(a.initial_balance) from public.accounts a where a.user_id = s.user_id), 0)
        + coalesce((select sum(o.amount) from public.operations o where o.user_id = s.user_id and o.type = 'income'), 0)
        - coalesce((select sum(o.amount) from public.operations o where o.user_id = s.user_id and o.type = 'expense'), 0)
        - coalesce((select sum(o.amount) from public.operations o where o.user_id = s.user_id and o.type = 'daily'), 0)
      )::numeric as actual_total
    from public.migration_accounts_snapshot s
  ) q
  where q.expected_total is distinct from q.actual_total;

  if v_bad is not null then
    raise exception 'Проверка инварианта не пройдена:%', v_bad;
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from public.users u
    left join public.accounts a
      on a.user_id = u.id
     and a.is_primary
    where a.id is null
  ) then
    raise exception 'Проверка primary-аккаунта не пройдена: у одного или нескольких пользователей нет основного счёта';
  end if;

  if exists (
    select user_id
    from public.accounts
    where is_primary
    group by user_id
    having count(*) > 1
  ) then
    raise exception 'Проверка primary-аккаунта не пройдена: найдено несколько основных счетов у одного пользователя';
  end if;
end;
$$;

-- Дополнительно проверяем частичный уникальный индекс: попытка вставить второй primary
-- в рамках подтранзакции должна завершиться unique_violation.
do $$
declare
  v_user_id uuid;
begin
  select user_id
    into v_user_id
  from public.accounts
  where is_primary
  limit 1;

  if v_user_id is null then
    raise notice 'Проверка uniqueness primary пропущена: основных счетов нет';
    return;
  end if;

  begin
    insert into public.accounts (user_id, name, initial_balance, is_closed, is_primary)
    select user_id, '__migration_primary_uniqueness_test__', 0, false, true
    from public.accounts
    where user_id = v_user_id
      and is_primary
    limit 1;

    raise exception 'Проверка uniqueness primary не пройдена: индекс accounts_one_primary_key не запретил второй основной счёт';
  exception
    when unique_violation then
      raise notice 'Проверка uniqueness primary пройдена: второй основной счёт создать нельзя';
  end;
end;
$$;

do $$
begin
  if exists (
    select 1
    from public.operations
    where type in ('savings', 'savings_out')
  ) then
    raise exception 'Проверка типов операций не пройдена: остались savings/savings_out';
  end if;

  if exists (
    select 1
    from public.categories
    where type = 'savings'
  ) then
    raise exception 'Проверка категорий не пройдена: остались savings-категории';
  end if;

  if exists (
    select 1
    from public.category_limits cl
    left join public.categories c on c.id = cl.category_id
    where c.id is null
  ) then
    raise exception 'Проверка категорий не пройдена: остались category_limits для удалённых категорий';
  end if;
end;
$$;

drop table if exists public.migration_accounts_snapshot;

commit;
