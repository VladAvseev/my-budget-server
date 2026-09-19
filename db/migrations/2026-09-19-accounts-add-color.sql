-- Цвет счёта (nullable, как categories.color): колонка + бэкфилл случайным цветом из палитры.
-- Применение: docker compose exec -T db psql -U mybudget -d mybudget -f - < db/migrations/2026-09-19-accounts-add-color.sql. Идемпотентно.

begin;

alter table public.accounts
  add column if not exists color text;

-- Каждому счёту без цвета — независимый случайный цвет из 12 (повторы допустимы).
-- Только WHERE color IS NULL, чтобы повторный прогон не перетасовывал уже покрашенные.
update public.accounts
  set color = (array['#F2756E', '#7CCFA0', '#B77DE0', '#F5D74A', '#6FC4EE', '#EE7AB5', '#9AD97B', '#7F97D4', '#F5A65C', '#7ED0BC', '#C89BE0', '#CBE072'])[floor(random() * 12) + 1]
  where color is null;

commit;
