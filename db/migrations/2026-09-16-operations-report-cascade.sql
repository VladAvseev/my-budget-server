-- Удаление периода должно удалять его операции (как обещает UI «Удаление периода»).
-- До этого reports.repository.remove обнулял operations.report_id (SET NULL):
-- операции пропадали из выборок по report_id, но продолжали влиять на балансы
-- счетов (баланс считается по account_id без фильтра report_id).
-- Теперь удаление явное (DELETE в repository.remove), а FK выравниваем под него:
-- operations.report_id ON DELETE CASCADE вместо SET NULL.
-- Идемпотентность: DO-блок ищет FK по колонке (имя автогенерировано при создании
-- через inline REFERENCES) и пересоздаёт только если правило не каскад.
begin;

do $$
declare
  v_conname text;
  v_deltype char;
begin
  select c.conname, c.confdeltype into v_conname, v_deltype
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = t.oid and a.attnum = c.conkey[1]
   where n.nspname = 'public'
     and t.relname = 'operations'
     and c.contype = 'f'
     and a.attname = 'report_id'
   limit 1;

  if v_conname is null then
    alter table public.operations
      add constraint operations_report_id_fkey
      foreign key (report_id) references public.reports(id) on delete cascade;
  elsif v_deltype is distinct from 'c' then
    execute format('alter table public.operations drop constraint %I', v_conname);
    alter table public.operations
      add constraint operations_report_id_fkey
      foreign key (report_id) references public.reports(id) on delete cascade;
  end if;
end;
$$;

commit;
