-- Phase 2A. Apply only to the verified nonproduction project after review.
-- No email-based administrator bootstrap and no financial objects.
begin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (char_length(display_name) between 2 and 100),
  created_at timestamptz not null default now()
);
create table public.user_roles (
  user_id uuid not null references auth.users(id) on delete restrict,
  role text not null check (role in ('affiliate', 'admin')),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);
create table public.affiliates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete restrict,
  status text not null check (status in ('approved', 'suspended')),
  created_at timestamptz not null default now()
);
create table public.affiliate_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete restrict,
  display_name text not null check (char_length(display_name) between 2 and 100),
  promotion_url text not null check (char_length(promotion_url) between 10 and 2048 and promotion_url ~ '^https://[^[:space:]]+$'),
  promotion_plan text not null check (char_length(promotion_plan) between 30 and 2000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  check ((status = 'pending' and reviewed_at is null) or (status <> 'pending' and reviewed_at is not null))
);
create index affiliate_applications_review_queue on public.affiliate_applications(status, created_at);
create table public.application_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.affiliate_applications(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  event_type text not null check (event_type in ('submitted', 'approved', 'rejected')),
  reason text not null check (char_length(reason) between 3 and 1000),
  created_at timestamptz not null default now()
);
create index application_events_application_time on public.application_events(application_id, created_at);
create index application_events_actor on public.application_events(actor_id);

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.affiliates enable row level security;
alter table public.affiliate_applications enable row level security;
alter table public.application_events enable row level security;

revoke all on public.profiles, public.user_roles, public.affiliates, public.affiliate_applications, public.application_events from anon, authenticated;
grant select on public.profiles, public.user_roles, public.affiliates, public.affiliate_applications, public.application_events to authenticated;

create policy own_profile on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy own_roles on public.user_roles for select to authenticated using (user_id = (select auth.uid()));
create policy own_affiliate on public.affiliates for select to authenticated using (user_id = (select auth.uid()));
create policy own_application on public.affiliate_applications for select to authenticated using (user_id = (select auth.uid()));
create policy own_application_history on public.application_events for select to authenticated using (
  exists (select 1 from public.affiliate_applications a where a.id = application_id and a.user_id = (select auth.uid()))
);
create policy admin_application_read on public.affiliate_applications for select to authenticated using (
  (select auth.jwt()->>'aal') = 'aal2' and exists (select 1 from public.user_roles r where r.user_id = (select auth.uid()) and r.role = 'admin')
);
create policy admin_history_read on public.application_events for select to authenticated using (
  (select auth.jwt()->>'aal') = 'aal2' and exists (select 1 from public.user_roles r where r.user_id = (select auth.uid()) and r.role = 'admin')
);

create function public.submit_affiliate_application(p_display_name text, p_promotion_url text, p_promotion_plan text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null or not exists (select 1 from auth.users where id = v_user and email_confirmed_at is not null) then
    raise exception 'Verified account required' using errcode = '42501';
  end if;
  -- Serializes repeated submissions for the same account.
  perform 1 from auth.users where id = v_user for update;
  select id into v_id from public.affiliate_applications where user_id = v_user;
  if v_id is not null then return v_id; end if;
  if p_display_name is null or char_length(btrim(p_display_name)) not between 2 and 100
    or p_promotion_plan is null or char_length(btrim(p_promotion_plan)) not between 30 and 2000
    or p_promotion_url is null or char_length(p_promotion_url) not between 10 and 2048
    or p_promotion_url !~ '^https://[^[:space:]@]+$' then
    raise exception 'Invalid application fields' using errcode = '22023';
  end if;
  insert into public.profiles(id, display_name) values (v_user, btrim(p_display_name)) on conflict (id) do nothing;
  insert into public.affiliate_applications(user_id, display_name, promotion_url, promotion_plan)
    values (v_user, btrim(p_display_name), p_promotion_url, btrim(p_promotion_plan)) returning id into v_id;
  insert into public.application_events(application_id, actor_id, event_type, reason)
    values (v_id, v_user, 'submitted', 'Application submitted by account owner');
  return v_id;
end;
$$;

create function public.review_affiliate_application(p_application_id uuid, p_decision text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_application public.affiliate_applications%rowtype;
begin
  if v_actor is null or (auth.jwt()->>'aal') is distinct from 'aal2'
    or not exists (select 1 from public.user_roles where user_id = v_actor and role = 'admin') then
    raise exception 'MFA administrator access required' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') or p_reason is null or char_length(btrim(p_reason)) not between 3 and 1000 then
    raise exception 'Decision and reason required' using errcode = '22023';
  end if;
  select * into v_application from public.affiliate_applications where id = p_application_id for update;
  if not found then raise exception 'Application not found' using errcode = 'P0002'; end if;
  if v_application.user_id = v_actor then raise exception 'Self approval is prohibited' using errcode = '42501'; end if;
  if v_application.status = p_decision then return; end if;
  if v_application.status <> 'pending' then raise exception 'Application already decided' using errcode = '22023'; end if;
  update public.affiliate_applications set status = p_decision, reviewed_at = now() where id = p_application_id;
  if p_decision = 'approved' then
    insert into public.affiliates(user_id, status) values (v_application.user_id, 'approved');
    insert into public.user_roles(user_id, role) values (v_application.user_id, 'affiliate') on conflict do nothing;
  end if;
  insert into public.application_events(application_id, actor_id, event_type, reason)
    values (p_application_id, v_actor, p_decision, btrim(p_reason));
end;
$$;

create function public.prevent_application_event_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Application history is append-only' using errcode = '42501';
end;
$$;
create trigger immutable_application_events before update or delete on public.application_events
for each row execute function public.prevent_application_event_change();

revoke all on function public.submit_affiliate_application(text, text, text) from public, anon, authenticated;
revoke all on function public.review_affiliate_application(uuid, text, text) from public, anon, authenticated;
revoke all on function public.prevent_application_event_change() from public, anon, authenticated;
grant execute on function public.submit_affiliate_application(text, text, text) to authenticated;
grant execute on function public.review_affiliate_application(uuid, text, text) to authenticated;

commit;