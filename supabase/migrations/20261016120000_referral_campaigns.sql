begin;

-- Affiliates.id is the permanent partner identity. Codes are opaque, immutable
-- campaign identities, not editable user metadata or sequential account IDs.
create table public.referral_campaigns (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete restrict,
  request_id uuid not null unique,
  code text not null unique default replace(gen_random_uuid()::text, '-', '') check (code ~ '^[a-f0-9]{32}$'),
  name text not null check (char_length(btrim(name)) between 2 and 80 and name !~ '[[:cntrl:]]'),
  destination_path text not null check (char_length(destination_path) <= 500 and destination_path ~ '^/([a-zA-Z0-9_-]+/)*[a-zA-Z0-9_-]*$'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.referral_campaigns enable row level security;
revoke all on public.referral_campaigns from public, anon, authenticated, service_role;
grant select on public.referral_campaigns to authenticated;
create policy own_campaign_read on public.referral_campaigns for select to authenticated using (
  exists (select 1 from public.affiliates a where a.id = affiliate_id and a.user_id = (select auth.uid()) and a.status = 'approved')
  and exists (select 1 from public.user_roles r where r.user_id = (select auth.uid()) and r.role = 'affiliate')
);

create function public.create_referral_campaign(p_request_id uuid, p_name text, p_destination_path text)
returns text language plpgsql security definer set search_path = '' as $$
declare a public.affiliates%rowtype; c public.referral_campaigns%rowtype;
begin
  -- Per-partner lock serializes retries and the limit under concurrent requests.
  select * into a from public.affiliates where user_id = auth.uid() and status = 'approved' for update;
  if not found or not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'affiliate') then
    raise exception 'Approved partner required' using errcode = '42501';
  end if;
  if p_request_id is null or p_name is null or char_length(btrim(p_name)) not between 2 and 80
    or p_name ~ '[[:cntrl:]]' or p_destination_path is null or char_length(p_destination_path) > 500
    or p_destination_path !~ '^/([a-zA-Z0-9_-]+/)*[a-zA-Z0-9_-]*$' then
    raise exception 'Invalid campaign' using errcode = '22023';
  end if;
  select * into c from public.referral_campaigns where request_id = p_request_id;
  if found then
    if c.affiliate_id = a.id and c.name = btrim(p_name) and c.destination_path = p_destination_path then return c.code; end if;
    raise exception 'Conflicting request' using errcode = '40001';
  end if;
  if (select count(*) from public.referral_campaigns where affiliate_id = a.id) >= 50 then
    raise exception 'Campaign limit reached' using errcode = '54000';
  end if;
  insert into public.referral_campaigns(affiliate_id, request_id, name, destination_path)
    values (a.id, p_request_id, btrim(p_name), p_destination_path) returning code into c.code;
  return c.code;
end;
$$;

create function public.set_referral_campaign_active(p_code text, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.affiliates%rowtype;
begin
  select * into a from public.affiliates where user_id = auth.uid() and status = 'approved' for update;
  if not found or not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'affiliate') then
    raise exception 'Approved partner required' using errcode = '42501';
  end if;
  if p_active is null or p_code is null or p_code !~ '^[a-f0-9]{32}$' then
    raise exception 'Invalid campaign' using errcode = '22023';
  end if;
  update public.referral_campaigns set active = p_active where code = p_code and affiliate_id = a.id;
  if not found then raise exception 'Campaign unavailable' using errcode = '42501'; end if;
end;
$$;

-- Minimal public lookup; reveals no partner IDs, private names or account data.
-- No click insertion RPC is exposed to anonymous callers.
create function public.resolve_referral_campaign(p_code text)
returns text language sql stable security definer set search_path = '' as $$
  select c.destination_path from public.referral_campaigns c
  join public.affiliates a on a.id = c.affiliate_id
  where c.code = p_code and p_code ~ '^[a-f0-9]{32}$' and c.active and a.status = 'approved'
  and exists (select 1 from public.user_roles r where r.user_id = a.user_id and r.role = 'affiliate');
$$;
revoke all on function public.create_referral_campaign(uuid,text,text), public.set_referral_campaign_active(text,boolean),
  public.resolve_referral_campaign(text) from public, anon, authenticated, service_role;
grant execute on function public.create_referral_campaign(uuid,text,text), public.set_referral_campaign_active(text,boolean) to authenticated;
grant execute on function public.resolve_referral_campaign(text) to anon, authenticated;
commit;