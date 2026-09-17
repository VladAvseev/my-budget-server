-- Добавляет колонку user_role в request_logs (роль автора из JWT на момент запроса).
-- Применение: docker compose exec -T db psql -U mybudget -d mybudget -f - < db/migrations/2026-09-11-request-logs-user-role.sql. Идемпотентно.

-- Повтор не задваивает констрейн.
alter table public.request_logs
  add column if not exists user_role text
  check (user_role in ('user', 'admin'));

-- Проставляем роли по users.role; строкам без автора остаётся NULL.
update public.request_logs rl
   set user_role = u.role
  from public.users u
 where rl.user_id = u.id
   and rl.user_role is null;

-- Индекс под фильтры/группировку по роли в графике логов (audience='users').
create index if not exists request_logs_user_role_created_at_idx
  on public.request_logs (user_role, created_at desc);
