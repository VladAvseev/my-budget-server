-- Цели по счетам. Старые цели по категориям осознанно удаляются без переноса.
-- Повторный запуск сохраняет цели новой структуры. Применять после миграций счетов.
BEGIN;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'goals' AND column_name = 'category_id'
  ) THEN
    DROP TABLE public.goals;
  END IF;
END;
$$;
CREATE TABLE IF NOT EXISTS public.goals (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    account_id uuid NOT NULL CONSTRAINT goals_account_id_key UNIQUE
        REFERENCES public.accounts(id) ON DELETE CASCADE,
    amount numeric NOT NULL CONSTRAINT goals_amount_check
        CHECK (amount > 0 AND amount < 'Infinity'::numeric),
    target_date date,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS goals_user_id_idx ON public.goals(user_id);
COMMIT;
