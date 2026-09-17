-- Вход по login (citext, unique) вместо email.
-- Применение: docker compose exec -T db psql -U mybudget -d mybudget -f - < db/migrations/2026-09-12-replace-email-with-login.sql. Идемпотентно.

alter table public.users add column if not exists login citext;

do $$
declare
  r record;
  candidate text;
  n integer;
begin
  for r in
    select
      id,
      left(
        lower(
          regexp_replace(split_part(email, '@', 1), '[^a-zа-яё0-9_.-]', '', 'g')
        ),
        20
      ) as base
    from public.users
    where login is null
    order by created_at, id
  loop
    if char_length(r.base) < 3 then
      candidate := r.base || substr(md5(r.id::text), 1, 3 - char_length(r.base));
    else
      candidate := r.base;
    end if;

    n := 2;
    -- UPDATE выполняется на каждой итерации, поэтому exists по users видит
    -- и логины, проставленные в этом же цикле.
    while exists (select 1 from public.users u2 where u2.login = candidate) loop
      candidate := left(r.base, 20 - length(n::text) - 1) || '_' || n::text;
      n := n + 1;
    end loop;

    update public.users set login = candidate where id = r.id;
  end loop;
end
$$;

-- Повторный запуск безопасен (drop-if-exists).
alter table public.users alter column login set not null;
alter table public.users drop constraint if exists users_login_key;
alter table public.users add constraint users_login_key unique (login);

alter table public.users drop column if exists email;
