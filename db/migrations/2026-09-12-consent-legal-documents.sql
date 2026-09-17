-- Юридические документы (legal_documents) и журнал согласий (consent_log).
-- user_id — FK без каскада (удаление — обезличивание); ip/ua хранятся шифрованно (ключ CONSENT_ENC_KEY).
-- Применение: docker compose exec -T db psql -U mybudget -d mybudget -f - < db/migrations/2026-09-12-consent-legal-documents.sql, затем npm run legal:publish. Идемпотентно.

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
