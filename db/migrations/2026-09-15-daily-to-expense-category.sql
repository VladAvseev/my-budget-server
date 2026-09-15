-- Миграция данных 2026-09-15: перенос operations.type='daily' в 'expense'.
--
-- Каждому пользователю с daily-операциями заводится категория
-- «Ежедневные расходы» (type='expense', color='#F2756E'),
-- если у него ещё нет expense-категории с таким именем (без учёта регистра),
-- затем все его daily-операции переводятся в expense с привязкой к этой категории.
-- INSERT идёт минимальным набором колонок (user_id, name, type, color):
-- именно такие есть и в живой БД (см. _categories/repository.ts),
-- и в schema.sql (остальные колонки там nullable/с дефолтами).
-- Остальные поля операций (amount, date, time, account_id/from/to_account_id,
-- report_id, description, created_at) не трогаются; updated_at двигает
-- trg_operations_updated_at — это ожидаемо, триггер не отключаем.
-- Сидовые daily-категории (seed_default_categories_for_user), CHECK-и и код
-- здесь не трогаем — это отдельная задача; после этой миграции reports
-- daily-флоу до правки кода молча считает перенесённые суммы как expense.
--
-- Применение — см. server/AGENTS.md:
--   docker compose exec -T db psql -U mybudget -d mybudget -f - \
--     < db/migrations/2026-09-15-daily-to-expense-category.sql
--
-- Идемпотентно: повторный запуск безвреден (вставки/апдейты дадут 0 строк).

begin;

-- 1. Категория «Ежедневные расходы» каждому пользователю с daily-операциями,
-- у кого её ещё нет. user_id IS NOT NULL — защита от NOT NULL у categories
-- (сирот без пользователя в базе нет, проверено до миграции).
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
-- Подзапрос с distinct on гарантирует одну категорию на пользователя
-- (детерминированно — самую раннюю) даже при предсуществующих дублях имени.
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
