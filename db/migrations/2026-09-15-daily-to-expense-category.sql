-- Перенос operations.type='daily' в 'expense' с категорией «Ежедневные расходы».
-- Применение: docker compose exec -T db psql -U mybudget -d mybudget -f - < db/migrations/2026-09-15-daily-to-expense-category.sql. Идемпотентно.

begin;

-- 1. Категория «Ежедневные расходы» тем, у кого её ещё нет.
insert into public.categories (user_id, name, type, color)
select distinct o.user_id, 'Ежедневные расходы', 'expense', '#F2756E'
from public.operations o
where o.type = 'daily'
  and o.user_id is not null
  and not exists (
    select 1
    from public.categories c
    where c.user_id = o.user_id
      and c.type = 'expense'
      and lower(c.name) = lower('Ежедневные расходы')
  );

-- 2. Перенос операций: меняются только type и category_id.
-- При дублях имени — детерминированно самая ранняя категория.
update public.operations o
set type = 'expense',
    category_id = c.id
from (
  select distinct on (user_id) user_id, id
  from public.categories
  where type = 'expense'
    and lower(name) = lower('Ежедневные расходы')
  order by user_id, created_at, id
) c
where o.type = 'daily'
  and o.user_id is not null
  and c.user_id = o.user_id;

-- 3. Контроль: либо всё перенесено, либо транзакция откатывается целиком.
do $$
begin
  if exists (
    select 1
    from public.operations
    where type = 'daily'
  ) then
    raise exception 'остались operations type=daily';
  end if;
end;
$$;

commit;
