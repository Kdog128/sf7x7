
create table if not exists public.sf7x7_saves (
  id uuid primary key default gen_random_uuid(),
  owner_hash text not null,
  name text not null,
  meta jsonb not null default '{}'::jsonb,
  data text not null,
  share_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sf7x7_saves_owner_idx on public.sf7x7_saves (owner_hash, updated_at desc);
alter table public.sf7x7_saves enable row level security;
revoke all on table public.sf7x7_saves from anon, authenticated;
comment on table public.sf7x7_saves is '7x7 city builder cloud saves. RLS on with no policies: reachable only through the sf7x7_* security definer functions.';

create or replace function public.sf7x7_hash(p_token text) returns text
language sql immutable set search_path = '' as $$ select encode(sha256(convert_to(p_token, 'UTF8')), 'hex') $$;

create or replace function public.sf7x7_save(p_token text, p_id uuid, p_name text, p_meta jsonb, p_data text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare h text; v_id uuid; n int;
begin
  if p_token is null or length(p_token) < 24 or length(p_token) > 128 then raise exception 'bad token'; end if;
  if p_data is null or length(p_data) > 9000000 then raise exception 'save too large'; end if;
  h := public.sf7x7_hash(p_token);
  if p_id is not null then
    update public.sf7x7_saves set name = left(coalesce(p_name, name), 60), meta = coalesce(p_meta, '{}'::jsonb), data = p_data, updated_at = now()
      where id = p_id and owner_hash = h returning id into v_id;
    if v_id is not null then return v_id; end if;
  end if;
  select count(*) into n from public.sf7x7_saves where owner_hash = h;
  if n >= 12 then raise exception 'save limit reached'; end if;
  select count(*) into n from public.sf7x7_saves;
  if n >= 4000 then raise exception 'storage is full'; end if;
  insert into public.sf7x7_saves (owner_hash, name, meta, data) values (h, left(coalesce(nullif(p_name, ''), 'San Francisco'), 60), coalesce(p_meta, '{}'::jsonb), p_data) returning id into v_id;
  return v_id;
end $$;

create or replace function public.sf7x7_list(p_token text) returns table (id uuid, name text, meta jsonb, share_id text, updated_at timestamptz)
language sql security definer stable set search_path = '' as $$
  select s.id, s.name, s.meta, s.share_id, s.updated_at from public.sf7x7_saves s where s.owner_hash = public.sf7x7_hash(p_token) order by s.updated_at desc limit 20 $$;

create or replace function public.sf7x7_load(p_token text, p_id uuid) returns text
language sql security definer stable set search_path = '' as $$
  select s.data from public.sf7x7_saves s where s.id = p_id and s.owner_hash = public.sf7x7_hash(p_token) $$;

create or replace function public.sf7x7_delete(p_token text, p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n int;
begin delete from public.sf7x7_saves s where s.id = p_id and s.owner_hash = public.sf7x7_hash(p_token); get diagnostics n = row_count; return n > 0; end $$;

create or replace function public.sf7x7_share(p_token text, p_id uuid, p_on boolean default true) returns text
language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  if p_on then
    update public.sf7x7_saves s set share_id = coalesce(s.share_id, substr(replace(gen_random_uuid()::text, '-', ''), 1, 14))
      where s.id = p_id and s.owner_hash = public.sf7x7_hash(p_token) returning s.share_id into v;
  else
    update public.sf7x7_saves s set share_id = null where s.id = p_id and s.owner_hash = public.sf7x7_hash(p_token);
    v := null;
  end if;
  return v;
end $$;

create or replace function public.sf7x7_get_shared(p_share text) returns table (name text, meta jsonb, data text, updated_at timestamptz)
language sql security definer stable set search_path = '' as $$
  select s.name, s.meta, s.data, s.updated_at from public.sf7x7_saves s where s.share_id = p_share and length(p_share) >= 10 $$;

revoke all on function public.sf7x7_hash(text) from public, anon, authenticated;
revoke all on function public.sf7x7_save(text, uuid, text, jsonb, text) from public;
revoke all on function public.sf7x7_list(text) from public;
revoke all on function public.sf7x7_load(text, uuid) from public;
revoke all on function public.sf7x7_delete(text, uuid) from public;
revoke all on function public.sf7x7_share(text, uuid, boolean) from public;
revoke all on function public.sf7x7_get_shared(text) from public;
grant execute on function public.sf7x7_save(text, uuid, text, jsonb, text) to anon, authenticated;
grant execute on function public.sf7x7_list(text) to anon, authenticated;
grant execute on function public.sf7x7_load(text, uuid) to anon, authenticated;
grant execute on function public.sf7x7_delete(text, uuid) to anon, authenticated;
grant execute on function public.sf7x7_share(text, uuid, boolean) to anon, authenticated;
grant execute on function public.sf7x7_get_shared(text) to anon, authenticated;
