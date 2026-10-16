-- Independent of Woo ingestion. Drafts never drive ledger writes or transfers.
create table public.program_settings_drafts (
  revision integer primary key check (revision > 0),
  request_id uuid not null unique,
  commission_bps integer not null check (commission_bps between 0 and 10000),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  minimum_payout text not null check (minimum_payout ~ '^(0|[1-9][0-9]{0,8})(\.[0-9]{1,6})?$'),
  hold_days integer not null check (hold_days between 0 and 365),
  payout_cadence text not null check (payout_cadence in ('manual','weekly','monthly')),
  reason text not null check (char_length(btrim(reason)) between 10 and 1000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp()
);
alter table public.program_settings_drafts enable row level security;
revoke all on public.program_settings_drafts from public, anon, authenticated, service_role;
grant select on public.program_settings_drafts to authenticated;
create policy admin_draft_read on public.program_settings_drafts for select to authenticated using (
  (select auth.jwt()->>'aal') = 'aal2' and exists (
    select 1 from public.user_roles r where r.user_id = (select auth.uid()) and r.role = 'admin'
  )
);

create function public.save_program_settings_draft(
  p_request_id uuid, p_expected_revision integer, p_commission_bps integer,
  p_currency text, p_minimum_payout text, p_hold_days integer, p_payout_cadence text, p_reason text
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_latest integer;
  v_existing public.program_settings_drafts%rowtype;
begin
  if auth.uid() is null or (auth.jwt()->>'aal') is distinct from 'aal2' or not exists (
    select 1 from public.user_roles where user_id = auth.uid() and role = 'admin'
  ) then raise exception 'Administrator MFA required' using errcode = '42501'; end if;
  -- Serialize all writers, including the first revision. No app roles have direct write grants.
  lock table public.program_settings_drafts in exclusive mode;
  select * into v_existing from public.program_settings_drafts where request_id = p_request_id;
  if found then
    if v_existing.created_by = auth.uid() and v_existing.revision = p_expected_revision + 1
      and v_existing.commission_bps = p_commission_bps and v_existing.currency = p_currency
      and v_existing.minimum_payout = p_minimum_payout and v_existing.hold_days = p_hold_days
      and v_existing.payout_cadence = p_payout_cadence and v_existing.reason = btrim(p_reason)
    then return v_existing.revision; end if;
    raise exception 'Conflicting request' using errcode = '40001';
  end if;
  select coalesce(max(revision), 0) into v_latest from public.program_settings_drafts;
  if p_expected_revision is distinct from v_latest then
    raise exception 'Stale revision' using errcode = '40001';
  end if;
  insert into public.program_settings_drafts
    (revision, request_id, commission_bps, currency, minimum_payout, hold_days, payout_cadence, reason, created_by)
  values (v_latest + 1, p_request_id, p_commission_bps, p_currency, p_minimum_payout,
    p_hold_days, p_payout_cadence, btrim(p_reason), auth.uid());
  return v_latest + 1;
end;
$$;
revoke all on function public.save_program_settings_draft(uuid, integer, integer, text, text, integer, text, text) from public, anon, authenticated, service_role;
grant execute on function public.save_program_settings_draft(uuid, integer, integer, text, text, integer, text, text) to authenticated;