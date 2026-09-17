-- Удаляет тип daily из контрактов (данные уже перенесены в expense).
-- Применение: docker compose exec -T db psql -U mybudget -d mybudget -f - < db/migrations/2026-09-16-remove-daily.sql. Идемпотентно.

begin;

-- Контроль: строк daily быть не должно.
do $$
begin
  if exists (select 1 from public.operations where type = 'daily') then
    raise exception 'остались operations type=daily: сначала примените 2026-09-15-daily-to-expense-category.sql';
  end if;
  if exists (select 1 from public.categories where type = 'daily') then
    raise exception 'остались categories type=daily';
  end if;
end;
$$;

alter table public.categories drop constraint if exists categories_type_check;
alter table public.categories add constraint categories_type_check
  check (type = any (array['income'::text, 'expense'::text]));

alter table public.operations drop constraint if exists operations_type_check;
alter table public.operations add constraint operations_type_check
  check (type = any (array['income'::text, 'expense'::text, 'transfer'::text]));

alter table public.reports drop column if exists has_daily_expenses;
alter table public.reports drop column if exists daily_budget;

create or replace function public.seed_default_categories_for_user()
 returns trigger
 language plpgsql
as $function$
begin
  insert into public.categories (user_id, name, type, icon, color)
  values
    (new.id, 'Зарплата', 'income', '💼', '#4CAF50'),
    (new.id, 'Фриланс', 'income', '💻', '#8BC34A'),
    (new.id, 'Подарки', 'income', '🎁', '#FF9800'),
    (new.id, 'Продукты', 'expense', '🛒', '#2196F3'),
    (new.id, 'Транспорт', 'expense', '🚌', '#9C27B0'),
    (new.id, 'Развлечения', 'expense', '🎮', '#E91E63'),
    (new.id, 'Кафе и рестораны', 'expense', '🍽️', '#FF5722'),
    (new.id, 'Жильё', 'expense', '🏠', '#795548'),
    (new.id, 'Здоровье', 'expense', '💊', '#00BCD4')
  on conflict do nothing;

  return new;
end;
$function$;

commit;
