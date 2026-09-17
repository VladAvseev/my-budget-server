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
-- Не трогаем: users, refresh_tokens, request_logs, admin_notes, consent_log,
-- legal_documents, user_settings (служебное и юридически значимое).
-- report_period_settings, category_group_assignments, report_group_overrides включены:
-- у всех трёх есть user_id NOT NULL FK → users ON DELETE CASCADE, т.е. это
-- пользовательские данные (конфигурация отчётов), а не служебные.
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
UNION ALL SELECT 'category_group_assignments', count(*) FROM public.category_group_assignments WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47')
UNION ALL SELECT 'report_group_overrides', count(*) FROM public.report_group_overrides WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47')
UNION ALL SELECT 'report_period_settings', count(*) FROM public.report_period_settings WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47')
ORDER BY 1;

-- 3. Отключаем BEFORE UPDATE-триггеры set_updated_at: иначе они молча перезапишут
-- updated_at на now() и испортят backdate (а на categories без колонки updated_at
-- UPDATE вообще упал бы с ошибкой). Защитные триггеры счетов не трогаем.
-- У reports и goals такого триггера нет в schema.sql — их обновляем напрямую.
ALTER TABLE public.accounts DISABLE TRIGGER trg_accounts_updated_at;
ALTER TABLE public.operations DISABLE TRIGGER trg_operations_updated_at;
ALTER TABLE public.categories DISABLE TRIGGER trg_categories_updated_at;
ALTER TABLE public.category_limits DISABLE TRIGGER trg_category_limits_updated_at;
ALTER TABLE public.category_group_assignments DISABLE TRIGGER trg_category_group_assignments_updated_at;
ALTER TABLE public.report_group_overrides DISABLE TRIGGER trg_report_group_overrides_updated_at;
ALTER TABLE public.report_period_settings DISABLE TRIGGER trg_report_period_settings_updated_at;

-- 4. Backdate пользовательских строк (всегда через подзапрос id — идемпотентно).
UPDATE public.accounts SET created_at = '2026-08-01 12:00:00+03'::timestamptz, updated_at = '2026-08-01 12:00:00+03'::timestamptz WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47');
UPDATE public.reports SET created_at = '2026-08-01 12:00:00+03'::timestamptz, updated_at = '2026-08-01 12:00:00+03'::timestamptz WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47');
UPDATE public.category_limits SET created_at = '2026-08-01 12:00:00+03'::timestamptz, updated_at = '2026-08-01 12:00:00+03'::timestamptz WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47');
UPDATE public.goals SET created_at = '2026-08-01 12:00:00+03'::timestamptz, updated_at = '2026-08-01 12:00:00+03'::timestamptz WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47');
UPDATE public.operations SET created_at = '2026-08-01 12:00:00+03'::timestamptz, updated_at = '2026-08-01 12:00:00+03'::timestamptz WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47');
UPDATE public.categories SET created_at = '2026-08-01 12:00:00+03'::timestamptz WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47');
UPDATE public.category_group_assignments SET created_at = '2026-08-01 12:00:00+03'::timestamptz, updated_at = '2026-08-01 12:00:00+03'::timestamptz WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47');
UPDATE public.report_group_overrides SET created_at = '2026-08-01 12:00:00+03'::timestamptz, updated_at = '2026-08-01 12:00:00+03'::timestamptz WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47');
UPDATE public.report_period_settings SET created_at = '2026-08-01 12:00:00+03'::timestamptz, updated_at = '2026-08-01 12:00:00+03'::timestamptz WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47');

-- 5. Включаем триггеры обратно.
ALTER TABLE public.accounts ENABLE TRIGGER trg_accounts_updated_at;
ALTER TABLE public.operations ENABLE TRIGGER trg_operations_updated_at;
ALTER TABLE public.categories ENABLE TRIGGER trg_categories_updated_at;
ALTER TABLE public.category_limits ENABLE TRIGGER trg_category_limits_updated_at;
ALTER TABLE public.category_group_assignments ENABLE TRIGGER trg_category_group_assignments_updated_at;
ALTER TABLE public.report_group_overrides ENABLE TRIGGER trg_report_group_overrides_updated_at;
ALTER TABLE public.report_period_settings ENABLE TRIGGER trg_report_period_settings_updated_at;

-- 6. Контроль после: строк НЕ на целевой метке (везде должны быть нули).
SELECT 'accounts' AS таблица, count(*) AS не_на_метке FROM public.accounts WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47') AND (created_at IS DISTINCT FROM '2026-08-01 12:00:00+03'::timestamptz OR updated_at IS DISTINCT FROM '2026-08-01 12:00:00+03'::timestamptz)
UNION ALL SELECT 'reports', count(*) FROM public.reports WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47') AND (created_at IS DISTINCT FROM '2026-08-01 12:00:00+03'::timestamptz OR updated_at IS DISTINCT FROM '2026-08-01 12:00:00+03'::timestamptz)
UNION ALL SELECT 'category_limits', count(*) FROM public.category_limits WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47') AND (created_at IS DISTINCT FROM '2026-08-01 12:00:00+03'::timestamptz OR updated_at IS DISTINCT FROM '2026-08-01 12:00:00+03'::timestamptz)
UNION ALL SELECT 'goals', count(*) FROM public.goals WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47') AND (created_at IS DISTINCT FROM '2026-08-01 12:00:00+03'::timestamptz OR updated_at IS DISTINCT FROM '2026-08-01 12:00:00+03'::timestamptz)
UNION ALL SELECT 'operations', count(*) FROM public.operations WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47') AND (created_at IS DISTINCT FROM '2026-08-01 12:00:00+03'::timestamptz OR updated_at IS DISTINCT FROM '2026-08-01 12:00:00+03'::timestamptz)
UNION ALL SELECT 'categories', count(*) FROM public.categories WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47') AND created_at IS DISTINCT FROM '2026-08-01 12:00:00+03'::timestamptz
UNION ALL SELECT 'category_group_assignments', count(*) FROM public.category_group_assignments WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47') AND (created_at IS DISTINCT FROM '2026-08-01 12:00:00+03'::timestamptz OR updated_at IS DISTINCT FROM '2026-08-01 12:00:00+03'::timestamptz)
UNION ALL SELECT 'report_group_overrides', count(*) FROM public.report_group_overrides WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47') AND (created_at IS DISTINCT FROM '2026-08-01 12:00:00+03'::timestamptz OR updated_at IS DISTINCT FROM '2026-08-01 12:00:00+03'::timestamptz)
UNION ALL SELECT 'report_period_settings', count(*) FROM public.report_period_settings WHERE user_id = (SELECT id FROM public.users WHERE login = 'vladavseev47') AND (created_at IS DISTINCT FROM '2026-08-01 12:00:00+03'::timestamptz OR updated_at IS DISTINCT FROM '2026-08-01 12:00:00+03'::timestamptz)
ORDER BY 1;

COMMIT;
