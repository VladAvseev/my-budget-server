-- Инкрементальная миграция 2026-09-11: в request_logs добавлена колонка user_role.
--
-- requestLoggingMiddleware теперь пишет роль автора из JWT-claim на момент
-- запроса ('user' | 'admin'), чтобы графики/фильтры админки могли отличать
-- операции и запросы обычных пользователей от админских (роль в users со
-- временем может измениться — фиксируем её в момент запроса).
--
-- Применение — см. server/AGENTS.md:
--   docker compose exec -T db psql -U mybudget -d mybudget -f - \
--     < db/migrations/2026-09-11-request-logs-user-role.sql
--
-- Идемпотентно: можно выполнять повторно и поверх уже обновлённой базы.

-- Колонка + чек-констрейн. ADD COLUMN IF NOT EXISTS ... CHECK целиком
-- пропускается, если колонка уже есть, — констрейн не задвоится при повторе.
alter table public.request_logs
  add column if not exists user_role text
  check (user_role in ('user', 'admin'));

-- Проставляем роли существующих записей. Почта/роль в самой строке лога
-- исторически не хранились — единственный источник роли на момент запроса,
-- который у нас остался, это автор: сопоставляем user_id -> users.role.
--
-- Ограничение: у строк без авторизации (is_authenticated = false) и у строк
-- с уже удалённым пользователем (user_id обнулён каскадом on delete set null)
-- автора нет, восстановить роль невозможно — они остаются NULL (в фильтр
-- «Пользователи» не попадают). Удалённых пользователей с нераскрытой ролью,
-- как правило, единицы.
update public.request_logs rl
   set user_role = u.role
  from public.users u
 where rl.user_id = u.id
   and rl.user_role is null;

-- Индекс под фильтры/группировку по роли в графике логов (audience='users').
create index if not exists request_logs_user_role_created_at_idx
  on public.request_logs (user_role, created_at desc);
