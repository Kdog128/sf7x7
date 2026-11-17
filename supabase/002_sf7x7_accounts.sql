-- Accounts for cloud saves. Signed-in players own rows by user_id and reach the table directly through
-- row level security policies. Guests keep the sync-code path from 001 (owner_hash + security definer
-- functions), and sf7x7_claim moves a guest's saves onto their account the first time they sign in.

alter table public.sf7x7_saves alter column owner_hash drop not null;
alter table public.sf7x7_saves add column if not exists user_id uuid references auth.users (id) on delete cascade default auth.uid();
alter table public.sf7x7_saves add constraint sf7x7_saves_one_owner check (num_nonnulls(owner_hash, user_id) = 1);
create index if not exists sf7x7_saves_user_idx on public.sf7x7_saves (user_id, updated_at desc) where user_id is not null;

-- Signed-in players: their own rows only. Column grants keep owner_hash, user_id and share_id out of
-- client writes; sharing goes through sf7x7_share_mine so share ids stay random.
grant select (id, user_id, name, meta, data, share_id, created_at, updated_at) on public.sf7x7_saves to authenticated;
grant insert (name, meta, data) on public.sf7x7_saves to authenticated;
grant update (name, meta, data) on public.sf7x7_saves to authenticated;
grant delete on public.sf7x7_saves to authenticated;

create policy sf7x7_saves_select_own on public.sf7x7_saves for select to authenticated using (user_id = (select auth.uid()));
create policy sf7x7_saves_insert_own on public.sf7x7_saves for insert to authenticated with check (user_id = (select auth.uid()));
create policy sf7x7_saves_update_own on public.sf7x7_saves for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy sf7x7_saves_delete_own on public.sf7x7_saves for delete to authenticated using (user_id = (select auth.uid()));

-- The same limits the guest functions enforce, applied to account rows: 12 saves each, 9 MB each,
-- 4,000 rows in total. Security definer so the total count sees every row, not just the caller's.
create or replace function public.sf7x7_account_limits() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if new.user_id is null then return new; end if;
  if new.data is null or length(new.data) > 9000000 then raise exception 'save too large'; end if;
  new.name := left(coalesce(nullif(btrim(new.name), ''), 'San Francisco'), 60);
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('sf7x7:' || new.user_id::text));
    select count(*) into n from public.sf7x7_saves where user_id = new.user_id;
    if n >= 12 then raise exception 'save limit reached'; end if;
    select count(*) into n from public.sf7x7_saves;
    if n >= 4000 then raise exception 'storage is full'; end if;
  elsif (new.name, new.meta, new.data) is distinct from (old.name, old.meta, old.data) then
    new.updated_at := now();   -- not for share or claim updates, so the list order stays put
  end if;
  return new;
end $$;
revoke all on function public.sf7x7_account_limits() from public, anon, authenticated;
drop trigger if exists sf7x7_saves_account_limits on public.sf7x7_saves;
create trigger sf7x7_saves_account_limits before insert or update on public.sf7x7_saves
  for each row execute function public.sf7x7_account_limits();

-- user_id defaults to auth.uid(), so a guest save made while a session token is attached would carry
-- both owners and fail the check above. The guest insert now says user_id is null outright.
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
  insert into public.sf7x7_saves (owner_hash, user_id, name, meta, data) values (h, null, left(coalesce(nullif(p_name, ''), 'San Francisco'), 60), coalesce(p_meta, '{}'::jsonb), p_data) returning id into v_id;
  return v_id;
end $$;

-- Turn a share link on or off for one of the caller's saves.
create or replace function public.sf7x7_share_mine(p_id uuid, p_on boolean default true) returns text
language plpgsql security definer set search_path = '' as $$
declare v text; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in'; end if;
  if p_on then
    update public.sf7x7_saves s set share_id = coalesce(s.share_id, substr(replace(gen_random_uuid()::text, '-', ''), 1, 14))
      where s.id = p_id and s.user_id = uid returning s.share_id into v;
  else
    update public.sf7x7_saves s set share_id = null where s.id = p_id and s.user_id = uid;
    v := null;
  end if;
  return v;
end $$;

-- Move the saves behind a guest sync code onto the caller's account, newest first, up to the
-- 12-save limit. Returns how many moved; anything over the limit stays with the sync code.
create or replace function public.sf7x7_claim(p_token text) returns int
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); room int; n int;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if p_token is null or length(p_token) < 24 or length(p_token) > 128 then return 0; end if;
  perform pg_advisory_xact_lock(hashtext('sf7x7:' || uid::text));
  select 12 - count(*) into room from public.sf7x7_saves where user_id = uid;
  if room <= 0 then return 0; end if;
  update public.sf7x7_saves s set user_id = uid, owner_hash = null
    where s.id in (select g.id from public.sf7x7_saves g where g.owner_hash = public.sf7x7_hash(p_token) order by g.updated_at desc limit room)
      and s.owner_hash = public.sf7x7_hash(p_token) and s.user_id is null;   -- rechecked after a row lock wait: a concurrent claim by another account wins, not both
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.sf7x7_share_mine(uuid, boolean) from public, anon;
revoke all on function public.sf7x7_claim(text) from public, anon;
grant execute on function public.sf7x7_share_mine(uuid, boolean) to authenticated;
grant execute on function public.sf7x7_claim(text) to authenticated;

comment on table public.sf7x7_saves is '7x7 city builder cloud saves. Account rows (user_id): RLS policies, owner only. Guest rows (owner_hash): reachable only through the sf7x7_* security definer functions.';
