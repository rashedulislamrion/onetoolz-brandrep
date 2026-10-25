begin;

-- Buyer store-link tokens (Phase 3 hub side). Depends on the referral
-- evidence migration 20261016170000, which creates the private referral
-- schema; install after it, exactly once. Do not replay earlier migrations.
--
-- A signed-in BrandRep user generates one token here, pastes it into the
-- OneToolz store (My Account -> BrandRep), and the store presents it as the
-- bridge bearer credential on order events instead of a live Supabase
-- session token. Only the SHA-256 hash is stored. Plaintext is shown to the
-- user once, at generation time, and can never be read back. Revoking (or
-- generating a replacement, which revokes the previous link first) is the
-- only mutation after insert; rows are never deleted or edited otherwise.
create table referral.store_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (revoked_at is null or revoked_at >= created_at)
);
-- One active link per user, enforced even under concurrent generation.
create unique index referral_store_links_one_active_per_user
  on referral.store_links(user_id) where revoked_at is null;
create index referral_store_links_user on referral.store_links(user_id, created_at);
alter table referral.store_links enable row level security;
revoke all on referral.store_links from public, anon, authenticated, service_role;

-- Append-only guard: deletes always fail; the only permitted update is the
-- one-way revoke transition on a still-active row, changing nothing else.
create function referral.guard_store_link_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'Store links are never deleted' using errcode = '42501';
  end if;
  if NEW.id is distinct from OLD.id or NEW.user_id is distinct from OLD.user_id
    or NEW.token_hash is distinct from OLD.token_hash
    or NEW.created_at is distinct from OLD.created_at
    or OLD.revoked_at is not null or NEW.revoked_at is null then
    raise exception 'Store links only permit revocation' using errcode = '42501';
  end if;
  return NEW;
end;
$$;
revoke all on function referral.guard_store_link_change() from public, anon, authenticated, service_role;
create trigger referral_store_links_guard before update or delete on referral.store_links
  for each row execute function referral.guard_store_link_change();

-- Generation is authenticated-only and requires a confirmed email, matching
-- submit_affiliate_application. The caller supplies only the token hash;
-- the plaintext never reaches storage. Any previous active link for the
-- caller is revoked in the same transaction (one active link per user).
create function public.create_store_link(p_token_hash text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null or not exists (select 1 from auth.users where id = v_user and email_confirmed_at is not null) then
    raise exception 'Verified account required' using errcode = '42501';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid token hash' using errcode = '22023';
  end if;
  -- Serializes concurrent generation for the same account.
  perform 1 from auth.users where id = v_user for update;
  update referral.store_links set revoked_at = clock_timestamp()
    where user_id = v_user and revoked_at is null;
  insert into referral.store_links(user_id, token_hash) values (v_user, p_token_hash)
    returning id into v_id;
  return v_id;
end;
$$;

create function public.revoke_store_link()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Account required' using errcode = '42501';
  end if;
  update referral.store_links set revoked_at = clock_timestamp()
    where user_id = v_user and revoked_at is null;
end;
$$;

-- Bridge-only resolution. Returns the linked user for an ACTIVE link, or
-- null for unknown, malformed or revoked hashes. The bridge service client
-- is the sole caller; browsers and partners can never resolve a hash.
create function public.resolve_store_link(p_token_hash text)
returns uuid language sql stable security definer set search_path = '' as $$
  select l.user_id from referral.store_links l
  where p_token_hash ~ '^[a-f0-9]{64}$' and l.token_hash = p_token_hash and l.revoked_at is null;
$$;

-- Dashboard status without exposing the private table: one row, always.
-- `active` is true only when the caller currently holds an unrevoked link,
-- with that link's creation time; otherwise false with a null timestamp.
create function public.store_link_status()
returns table(active boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_created timestamptz;
begin
  if v_user is null then
    raise exception 'Account required' using errcode = '42501';
  end if;
  select l.created_at into v_created from referral.store_links l
    where l.user_id = v_user and l.revoked_at is null;
  if found then
    return query select true, v_created;
  else
    return query select false, null::timestamptz;
  end if;
end;
$$;

revoke all on function public.create_store_link(text), public.revoke_store_link(),
  public.resolve_store_link(text), public.store_link_status()
  from public, anon, authenticated, service_role;
grant execute on function public.create_store_link(text), public.revoke_store_link(),
  public.store_link_status() to authenticated;
grant execute on function public.resolve_store_link(text) to service_role;
commit;
