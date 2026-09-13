-- Инкрементальная миграция 2026-09-12: юридически значимые согласия (152-ФЗ).
--
-- Создаёт два объекта схемы (полное описание — в db/schema.sql):
--   * public.legal_documents — версионируемые тексты документов (Markdown +
--     sha256), ровно одна is_current на document_type (частичный unique-индекс);
--   * public.consent_log — append-only журнал согласий/отзывов/удалений данных.
--
-- ПЕРЕСМОТР ПОЛИТИКИ ХРАНЕНИЯ IP. Миграция 2026-09-12-drop-ip-columns.sql
-- убрала IP из request_logs и refresh_tokens (тогда это были метаданные
-- логирования/сессий). Здесь IP и User-Agent снова пишутся в БД, но ТОЛЬКО в
-- consent_log и ТОЛЬКО как доказательство юридически значимого события
-- (ст. 9 152-ФЗ требует подтверждать получение согласия). Значения лежат
-- зашифрованными pgp_sym_encrypt(..., armor), ключ — env CONSENT_ENC_KEY api-
-- контейнера и скрипта публикации. Приложение их не читает; расшифровка для
-- разбора споров выполняется вручную:
--   SET key = '...';  -- значение CONSENT_ENC_KEY
--   SELECT created_at, user_id, form_id, action, document_type, document_version,
--          convert_from(pgp_sym_decrypt(dearmor(ip_address), current_setting('key')), 'UTF8') AS ip,
--          convert_from(pgp_sym_decrypt(dearmor(user_agent),  current_setting('key')), 'UTF8') AS ua
--     FROM public.consent_log
--    ORDER BY id DESC LIMIT 20;
--
-- consent_log.user_id — FK БЕЗ on delete cascade: journal обязан пережить
-- пользователя (хранение не менее 3 лет), поэтому physical delete аккаунта на
-- уровне БД невозможен; приложение вместо него выполняет обезличивание
-- (см. _consent/service.revokeAndErase).
--
-- Документ v1 публикуется после применения миграции (см. server/AGENTS.md):
--   npm run legal:publish -- --type privacy_policy --file <файл.md>
-- На проде: docker compose exec api node dist/scripts/publish-legal-document.js ...
--
-- Идемпотентно: можно выполнять повторно и поверх уже обновлённой базы.

begin;

-- ── Юридические документы ────────────────────────────────────────────────────
create table if not exists public.legal_documents (
  id uuid primary key default gen_random_uuid(),
  document_type text not null,
  version text not null,
  published_at timestamptz not null default now(),
  is_current boolean not null default false,
  content text not null,
  content_hash varchar(64) not null,
  unique (document_type, version)
);

create unique index if not exists legal_documents_current_key
  on public.legal_documents (document_type)
  where is_current;

-- ── Журнал согласий ──────────────────────────────────────────────────────────
create table if not exists public.consent_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users (id),
  ip_address text not null,
  user_agent text,
  document_type text not null,
  document_version text not null,
  form_id text not null check (form_id in ('registration', 'consent_gate', 'account_settings', 'admin')),
  action text not null check (action in ('granted', 'revoked', 'erased')),
  created_at timestamptz not null default now(),
  foreign key (document_type, document_version)
    references public.legal_documents (document_type, version)
);

create index if not exists idx_consent_log_user
  on public.consent_log (user_id, document_type, created_at desc);

commit;
