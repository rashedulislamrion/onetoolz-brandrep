-- Applied to nonproduction as version 20261015102213; no account grant in migration.
begin;
create table public.administrator_grant_events (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references auth.users(id) on delete restrict,
  database_actor text not null,
  operator_reference text not null check (char_length(operator_reference) between 3 and 200),
  reason text not null check (char_length(reason) between 10 and 1000),
  event_type text not null check (event_type = 'initial_admin_granted'),
  created_at timestamptz not null default now()
);
alter table public.administrator_grant_events enable row level security;
revoke all on public.administrator_grant_events from public, anon, authenticated, service_role;
create trigger immutable_administrator_grant_events before update or delete on public.administrator_grant_events
for each row execute function public.prevent_application_event_change();

-- Deliberately invoker, not definer. Only a trusted postgres operator may call.
-- Operator must independently verify the UUID and record an authorization reference.
create function public.bootstrap_initial_administrator(p_user_id uuid, p_operator_reference text, p_reason text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_event uuid;
begin
  if current_user <> 'postgres' then
    raise exception 'Trusted database operator required' using errcode = '42501';
  end if;
  if p_user_id is null or p_operator_reference is null or char_length(btrim(p_operator_reference)) not between 3 and 200
    or p_reason is null or char_length(btrim(p_reason)) not between 10 and 1000 then
    raise exception 'Verified UUID, operator reference and reason required' using errcode = '22023';
  end if;
  -- Serializes initial grants and blocks competing direct role inserts until commit.
  lock table public.user_roles in share row exclusive mode;
  if exists(select 1 from public.user_roles where role = 'admin')
    or exists(select 1 from public.administrator_grant_events) then
    raise exception 'Initial administrator already provisioned' using errcode = '22023';
  end if;
  perform 1 from auth.users where id = p_user_id and email_confirmed_at is not null
    and deleted_at is null and (banned_until is null or banned_until <= now()) for update;
  if not found then raise exception 'Active confirmed account required' using errcode = '42501'; end if;
  perform 1 from auth.mfa_factors where user_id = p_user_id and factor_type = 'totp' and status = 'verified' for update;
  if not found then raise exception 'Verified TOTP factor required' using errcode = '42501'; end if;
  insert into public.user_roles(user_id, role) values (p_user_id, 'admin');
  insert into public.administrator_grant_events(target_user_id, database_actor, operator_reference, reason, event_type)
    values (p_user_id, current_user, btrim(p_operator_reference), btrim(p_reason), 'initial_admin_granted') returning id into v_event;
  return v_event;
end;
$$;
revoke all on function public.bootstrap_initial_administrator(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.bootstrap_initial_administrator(uuid, text, text) to postgres;
commit;