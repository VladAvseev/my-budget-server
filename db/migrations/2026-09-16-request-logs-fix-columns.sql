-- Чинит колонки request_logs: status_code → status, error_text → error, тип — smallint.
-- Применение: docker compose exec -T db psql -U mybudget -d mybudget -f - < db/migrations/2026-09-16-request-logs-fix-columns.sql. Идемпотентно, без потери данных.

-- 1. status_code -> status.
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

-- 3. Тип status — smallint (только если сейчас integer).
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
