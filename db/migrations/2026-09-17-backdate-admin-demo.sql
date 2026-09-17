-- Инкрементальная миграция 2026-09-17: backdate демо-данных админа на 01.08.2026 12:00 МСК.
--
-- Нужно, чтобы сортировки и витрины выглядели как от 1 августа. Целевая метка одна
-- на весь скрипт: '2026-08-01 12:00:00+03'::timestamptz (12:00 МСК = 09:00 UTC).
--
-- Применение — см. server/AGENTS.md (флаг -T обязателен из-за TTY):
--   docker compose exec -T db psql -U mybudget -d mybudget -f - \
--     < db/migrations/2026-09-17-backdate-admin-demo.sql
--
-- Идемпотентно: повторный запуск ставит те же значения, безопасен.
-- users не меняем вообще. Бизнес-дату operations.date не трогаем — только технические метки.
-- Не трогаем: users, refresh_tokens, request_logs, consent_log, legal_documents
-- (служебное и юридически значимое).
-- Таблиц user_settings, admin_notes, category_group_assignments,
-- report_group_overrides, report_period_settings на проде нет (проверено запросом
-- к pg_tables — 0 строк) и в коде они не используются, поэтому их здесь нет.
BEGIN;

-- 1. Проверка пользователя (видно в выводе до изменений).
SELECT id, login, role FROM public.users WHERE login = 'vladavseev47';

-- 1б. Стоп-кран: не найден или не админ — исключение и откат всей транзакции.
DO $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.users WHERE login = 'vladavseev47';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Пользователь с login ''vladavseev47'' не найден — скрипт остановлен, изменения откачены.';
  END IF;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Пользователь ''vladavseev47'' не админ (role=''%'' ) — скрипт остановлен, изменения откачены.', v_role;
  END IF;
END
$$;

-- 2. Сколько строк затронет каждая таблица (до изменений).
SELECT 'accounts' AS таблица, count(*) AS строк FROM public.accounts WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47')
UNION ALL SELECT 'reports', count(*) FROM public.reports WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47')
UNION ALL SELECT 'category_limits', count(*) FROM public.category_limits WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47')
UNION ALL SELECT 'goals', count(*) FROM public.goals WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47')
UNION ALL SELECT 'operations', count(*) FROM public.operations WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47')
UNION ALL SELECT 'categories', count(*) FROM public.categories WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47')
ORDER BY 1;

-- 3. Глушим BEFORE UPDATE-триггеры set_updated_at на время транзакции: иначе они
-- молча перезапишут updated_at на now() и испортят backdate. SET LOCAL живёт
-- только до конца транзакции (на COMMIT/ROLLBACK сбрасывается сам), отдельного
-- «включить обратно» не нужно — а прямой DISABLE/ENABLE TRIGGER здесь нельзя:
-- после UPDATE у таблицы висят отложенные события и ENABLE падает с ошибкой
-- «cannot ALTER TABLE because it has pending trigger events».
-- Безопасно: скрипт меняет только created_at/updated_at, структурные колонки
-- и инварианты (включая защиту основного счёта) не затрагивает, реагировать
-- триггерам не на что. На базах без этих триггеров (код ставит updated_at
-- вручную) — безвредный no-op.
SET LOCAL session_replication_role = 'replica';

-- 4. Backdate пользовательских строк (всегда через подзапрос id — идемпотентно).
UPDATE public.accounts SET created_at = '2026-08-01 12:00:00+03'::timestamptz, updated_at = '2026-08-01 12:00:00+03'::timestamptz WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47');
UPDATE public.reports SET created_at = '2026-08-01 12:00:00+03'::timestamptz, updated_at = '2026-08-01 12:00:00+03'::timestamptz WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47');
UPDATE public.category_limits SET created_at = '2026-08-01 12:00:00+03'::timestamptz, updated_at = '2026-08-01 12:00:00+03'::timestamptz WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47');
UPDATE public.goals SET created_at = '2026-08-01 12:00:00+03'::timestamptz, updated_at = '2026-08-01 12:00:00+03'::timestamptz WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47');
UPDATE public.operations SET created_at = '2026-08-01 12:00:00+03'::timestamptz, updated_at = '2026-08-01 12:00:00+03'::timestamptz WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47');
UPDATE public.categories SET created_at = '2026-08-01 12:00:00+03'::timestamptz, updated_at = '2026-08-01 12:00:00+03'::timestamptz WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47');

-- 5. Триггеры включать обратно не нужно: SET LOCAL сбросился сам, дальше
-- транзакция идёт (контроль) и завершается COMMIT в обычном режиме.

-- 6. Контроль после: строк НЕ на целевой метке (везде должны быть нули).
SELECT 'accounts' AS таблица, count(*) AS не_на_метке FROM public.accounts WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47') AND (created_at IS DISTINCT FROM '2026-08-01 12:00:00+03'::timestamptz OR updated_at IS DISTINCT FROM '2026-08-01 12:00:00+03'::timestamptz)
UNION ALL SELECT 'reports', count(*) FROM public.reports WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47') AND (created_at IS DISTINCT FROM '2026-08-01 12:00:00+03'::timestamptz OR updated_at IS DISTINCT FROM '2026-08-01 12:00:00+03'::timestamptz)
UNION ALL SELECT 'category_limits', count(*) FROM public.category_limits WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47') AND (created_at IS DISTINCT FROM '2026-08-01 12:00:00+03'::timestamptz OR updated_at IS DISTINCT FROM '2026-08-01 12:00:00+03'::timestamptz)
UNION ALL SELECT 'goals', count(*) FROM public.goals WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47') AND (created_at IS DISTINCT FROM '2026-08-01 12:00:00+03'::timestamptz OR updated_at IS DISTINCT FROM '2026-08-01 12:00:00+03'::timestamptz)
UNION ALL SELECT 'operations', count(*) FROM public.operations WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47') AND (created_at IS DISTINCT FROM '2026-08-01 12:00:00+03'::timestamptz OR updated_at IS DISTINCT FROM '2026-08-01 12:00:00+03'::timestamptz)
UNION ALL SELECT 'categories', count(*) FROM public.categories WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47') AND (created_at IS DISTINCT FROM '2026-08-01 12:00:00+03'::timestamptz OR updated_at IS DISTINCT FROM '2026-08-01 12:00:00+03'::timestamptz)
ORDER BY 1;

COMMIT;
