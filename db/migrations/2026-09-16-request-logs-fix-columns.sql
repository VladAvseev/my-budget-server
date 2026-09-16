-- Инкрементальная миграция 2026-09-16: чинка колонок request_logs после
-- ошибочного переименования в коммите «миграция базы данных» (9573975).
--
-- Что случилось: db/schema.sql и db/dev/seed.sql какое-то время создавали
-- request_logs с колонками status_code/error_text, а весь живой код
-- (INSERT в requestLoggingMiddleware, SELECT'ы метрик/логов/динамики в
-- adminRepository) и все прод-миграции используют status/error. На проде
-- таблица правильная (собрана миграциями), поэтому там всё работает;
-- ломались только свежие БД из schema.sql/seed.sql: вставка логов падала
-- fire-and-forget (таблица оставалась пустой), а GET /admin/logs,
-- /admin/logs/metrics и /admin/logs/dynamics отвечали 500
-- («Внутренняя ошибка сервера», детали только в stderr).
--
-- Применение — см. server/AGENTS.md:
--   docker compose exec -T db psql -U mybudget -d mybudget -f - < db/migrations/2026-09-16-request-logs-fix-columns.sql
--
-- Идемпотентно и безопасно на проде: на правильной таблице оба RENAME-блока,
-- смена типа и пересоздание индексов — no-op (проверки через
-- information_schema/pg_class). Данных не теряем: только переименования.

-- 1. status_code -> status (код ждёт именно status: middleware + метрики).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'request_logs'
      AND column_name = 'status_code'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'request_logs'
      AND column_name = 'status'
  ) THEN
    ALTER TABLE public.request_logs RENAME COLUMN status_code TO status;
  END IF;
END;
$$;

-- 2. error_text -> error.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'request_logs'
      AND column_name = 'error_text'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'request_logs'
      AND column_name = 'error'
  ) THEN
    ALTER TABLE public.request_logs RENAME COLUMN error_text TO error;
  END IF;
END;
$$;

-- 3. Тип status к прод-канону smallint (только если сейчас integer;
-- на проде уже smallint — блок ничего не делает; значения статусов
-- 100–599 в smallint влезают с запасом).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'request_logs'
      AND column_name = 'status' AND data_type = 'integer'
  ) THEN
    ALTER TABLE public.request_logs ALTER COLUMN status TYPE smallint;
  END IF;
END;
$$;

-- 4. Индексы к прод-канону: неверные — удалить, недостающие — создать.
DROP INDEX IF EXISTS public.idx_request_logs_path_status;
DROP INDEX IF EXISTS public.idx_request_logs_created_at;
CREATE INDEX IF NOT EXISTS request_logs_created_at_idx
  ON public.request_logs USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS request_logs_status_created_at_idx
  ON public.request_logs USING btree (status, created_at DESC);
CREATE INDEX IF NOT EXISTS request_logs_user_id_idx
  ON public.request_logs USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS request_logs_user_role_created_at_idx
  ON public.request_logs USING btree (user_role, created_at DESC);
