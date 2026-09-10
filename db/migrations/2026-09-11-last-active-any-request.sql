-- Инкрементальная миграция 2026-09-11 (3): отметка активности на любом авторизованном запросе.
--
-- Раньше last_active_at двигал только триггер на вставку операции, поэтому
-- «активный пользователь» означало «добавил операцию», а не «заходил в
-- приложение». Теперь активность отмечает сам API-сервер (middlewares/
-- authMiddleware.ts) при каждом запросе с валидным access-токеном, а триггер
-- на operations убирается: он затирает last_active_at при любой пакетной
-- загрузке исторических операций (именно так и появились «одинаковые даты
-- активности» после переноса базы).
--
-- Применение — см. server/AGENTS.md:
--   docker compose exec -T db psql -U mybudget -d mybudget -f - \
--     < db/migrations/2026-09-11-last-active-any-request.sql
--
-- Идемпотентно: можно выполнять повторно и поверх уже обновлённой базы.

drop trigger if exists trg_operations_last_active on public.operations;
drop function if exists public.touch_last_active();

-- Функция общая для всех таблиц: updated_at двигаем только когда изменилась
-- хотя бы одна колонка, кроме самого updated_at и last_active_at — отметка
-- активности не должна менять дату изменения профиля.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  if to_jsonb(new) - 'updated_at' - 'last_active_at'
     is distinct from
     to_jsonb(old) - 'updated_at' - 'last_active_at' then
    new.updated_at = now();
  end if;
  return new;
end;
$$;
