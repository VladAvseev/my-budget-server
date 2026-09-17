-- Удаление неиспользуемых таблиц от 2026-09-17.
--
-- Таблицы user_settings, admin_notes, category_group_assignments,
-- report_group_overrides и report_period_settings достались schema.sql от слепка
-- старого бэкенда: их не создаёт ни одна миграция, к ним не обращается ни
-- сервер (server/src), ни клиент (client/src), ни docs. На проде их нет
-- (проверено: SELECT по pg_tables вернул 0 строк), а свежая БД из schema.sql
-- их создавала — отсюда расхождение «свежая БД ≠ прод».
-- Здесь догоняем свежие установки до состояния прода. На самом проде — no-op.
-- На эти таблицы никто не ссылается внешними ключами (они сами ссылаются
-- outward на users/reports/categories), поэтому DROP без CASCADE безопасен.
--
-- Применение — см. server/AGENTS.md:
--   docker compose exec -T db psql -U mybudget -d mybudget -f - \
--     < db/migrations/2026-09-17-drop-unused-tables.sql
--
-- Идемпотентно: IF EXISTS везде, повторный запуск безвреден.

begin;

drop trigger if exists trg_report_group_overrides_updated_at on public.report_group_overrides;
drop trigger if exists trg_category_group_assignments_updated_at on public.category_group_assignments;
drop trigger if exists trg_report_period_settings_updated_at on public.report_period_settings;

drop table if exists public.report_period_settings;
drop table if exists public.report_group_overrides;
drop table if exists public.category_group_assignments;
drop table if exists public.admin_notes;
drop table if exists public.user_settings;

commit;
