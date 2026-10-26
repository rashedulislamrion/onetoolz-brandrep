-- SOURCE-ONLY. Not installed anywhere. Depends on the identity migration
-- (public.affiliates/profiles), program policy publication
-- (20261016114552, plus rounding/qualification 20261026020000) and the
-- ledger foundation (20261015135651).
-- Phase 5 disbursements: affiliate payout requests with atomic ledger
-- reservation, administrator review (MFA + maker-checker), manual
-- settlement recording and failure/cancellation recovery. NO automated
-- transfer exists or is authorized: settlement only RECORDS an external
-- transfer an administrator performed outside this system, identified by
-- its external reference. The reserved -> clearing journal marks money
-- that has left for the payment rail; nothing here talks to a rail.
--
-- Money model (ledger foundation buckets, liability convention: an
-- affiliate bucket balance is credits - debits summed over ledger.lines;
-- there is no balance view in the ledger, posting state has always been
-- derived from lines):
--   request  : Dr payable  / Cr reserved   (payout:<key>:reserve)
--   cancel   : Dr reserved / Cr payable    (payout:<key>:release)
--   reject   : Dr reserved / Cr payable    (payout:<key>:release)
--   fail     : Dr reserved / Cr payable    (payout:<key>:release)
--   settle   : Dr reserved / Cr clearing   (payout:<key>:settle)
-- Because reservation is a journal (not a flag), the payable balance the
-- next request checks already excludes funds held by open requests; a
-- second reservation can never double-spend the same minor units. Each
-- request reaches at most one release/settle journal: status transitions
-- guard the paths and ledger.post_journal dedupes identical retries.
begin;
create schema payouts;
revoke all on schema payouts from public, anon, authenticated, service_role;

create table payouts.payout_requests (
  id uuid primary key default gen_random_uuid(),
  request_key text not null unique check (request_key ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'),
  affiliate_id uuid not null references public.affiliates(id) on delete restrict,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  exponent integer not null check (exponent between 0 and 6),
  amount_minor text not null check (amount_minor ~ '^[1-9][0-9]{0,18}$'),
  status text not null default 'requested'
    check (status in ('requested','approved','rejected','settled','cancelled','failed')),
  external_reference text check (external_reference is null
    or char_length(btrim(external_reference)) between 4 and 120),
  failure_reason text check (failure_reason is null
    or char_length(btrim(failure_reason)) between 3 and 1000),
  created_at timestamptz not null default now()
);
create index payout_requests_affiliate_time on payouts.payout_requests(affiliate_id, created_at desc, id desc);
create index payout_requests_queue on payouts.payout_requests(status, created_at, id) where status in ('requested','approved');

create table payouts.payout_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references payouts.payout_requests(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  kind text not null check (kind in ('requested','cancelled','approved','rejected','settled','failed')),
  detail text check (detail is null or char_length(detail) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index payout_events_request_time on payouts.payout_events(request_id, created_at, id);

alter table payouts.payout_requests enable row level security;
alter table payouts.payout_events enable row level security;
revoke all on payouts.payout_requests, payouts.payout_events from public, anon, authenticated, service_role;

create function payouts.reject_change() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'Payout events are append-only' using errcode = '42501';
end;
$$;
create trigger payout_events_immutable before update or delete or truncate on payouts.payout_events
for each statement execute function payouts.reject_change();
create trigger payout_requests_no_delete before delete or truncate on payouts.payout_requests
for each statement execute function payouts.reject_change();
revoke all on all functions in schema payouts from public, anon, authenticated, service_role;

-- Internal: convert a published policy's decimal minimum_payout text to
-- exact minor units under that policy's own currency_decimals. The policy
-- table constraint already guarantees the fraction fits the decimals.
create function payouts.minimum_minor(p_decimal text, p_decimals integer) returns numeric
language sql immutable set search_path = '' as $$
  select (split_part(p_decimal, '.', 1)::numeric * power(10, p_decimals))
    + case when position('.' in p_decimal) > 0
        then split_part(p_decimal, '.', 2)::numeric
             * power(10, p_decimals - length(split_part(p_decimal, '.', 2)))
        else 0 end;
$$;

-- Internal: liability-bucket balance (credits - debits) from journal lines.
create function payouts.account_balance(p_account_id uuid) returns numeric
language sql stable set search_path = '' as $$
  select coalesce(sum(credit_minor - debit_minor), 0)::numeric
  from ledger.lines where account_id = p_account_id;
$$;

-- Internal: get-or-create one ledger account, mirroring the commission
-- provisioning checks (currency row + exponent consistency). Platform
-- buckets (expense/clearing) pass a null affiliate id.
create function payouts.ensure_account(p_affiliate_id uuid, p_currency text,
  p_exponent integer, p_bucket text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into ledger.currencies(code, exponent) values (p_currency, p_exponent)
  on conflict (code) do nothing;
  if not exists(select 1 from ledger.currencies where code = p_currency and exponent = p_exponent) then
    raise exception 'Currency exponent mismatch' using errcode = '22023';
  end if;
  insert into ledger.accounts(affiliate_id, currency, exponent, bucket)
  values (p_affiliate_id, p_currency, p_exponent, p_bucket)
  on conflict (affiliate_id, currency, bucket) do nothing;
  select id into v_id from ledger.accounts
  where affiliate_id is not distinct from p_affiliate_id
    and currency = p_currency and bucket = p_bucket;
  if v_id is null then raise exception 'Payout account provisioning failed' using errcode = '22023'; end if;
  return v_id;
end;
$$;

-- Internal: journal posting surface for payouts, restricted to the
-- payout: effect-key namespace. Security-definer ownership by postgres is
-- what passes ledger.post_journal's operator-only current_user check;
-- application roles hold no grant on this function or the ledger schema.
create function payouts.post_journal(p_journal jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if p_journal is null or jsonb_typeof(p_journal) is distinct from 'object'
  or jsonb_typeof(p_journal->'effectKey') is distinct from 'string'
  or (p_journal->>'effectKey') not like 'payout:%' then
    raise exception 'Payout journal namespace required' using errcode = '22023';
  end if;
  return ledger.post_journal(p_journal, null);
end;
$$;

-- Internal: post one balanced two-line payout journal between two accounts.
create function payouts.move(p_effect_key text, p_currency text, p_exponent integer,
  p_reason text, p_debit_account uuid, p_credit_account uuid, p_amount_minor text) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  return payouts.post_journal(jsonb_build_object(
    'effectKey', p_effect_key, 'currency', p_currency, 'exponent', p_exponent, 'reason', p_reason,
    'lines', jsonb_build_array(
      jsonb_build_object('accountId', p_debit_account::text, 'currency', p_currency,
        'exponent', p_exponent, 'debitMinor', p_amount_minor, 'creditMinor', '0'),
      jsonb_build_object('accountId', p_credit_account::text, 'currency', p_currency,
        'exponent', p_exponent, 'debitMinor', '0', 'creditMinor', p_amount_minor))));
end;
$$;

create function payouts.require_admin() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or (auth.jwt()->>'aal') is distinct from 'aal2' or not exists(
    select 1 from public.user_roles where user_id = auth.uid() and role = 'admin'
  ) then raise exception 'Administrator MFA required' using errcode = '42501'; end if;
end;
$$;

-- Internal helpers are reachable only from the security-definer RPCs
-- below (they execute as the function owner); no application role may
-- call them directly.
revoke all on function payouts.minimum_minor(text, integer),
  payouts.account_balance(uuid),
  payouts.ensure_account(uuid, text, integer, text),
  payouts.post_journal(jsonb),
  payouts.move(text, text, integer, text, uuid, uuid, text),
  payouts.require_admin()
from public, anon, authenticated, service_role;

-- Request a payout. Approved affiliates only; the amount must meet the
-- CURRENT published policy minimum for the currency and fit the caller's
-- payable balance (which already excludes open reservations, because a
-- reservation is a payable -> reserved journal). Reservation and the
-- request row commit or fail together.
create function public.request_payout(p_request_key text, p_currency text, p_amount_minor text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_affiliate public.affiliates%rowtype;
  v_policy public.program_policies%rowtype;
  v_existing payouts.payout_requests%rowtype;
  v_payable uuid; v_reserved uuid; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_request_key is null or p_request_key !~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'
  or p_currency is null or p_currency !~ '^[A-Z]{3}$'
  or p_amount_minor is null or p_amount_minor !~ '^[1-9][0-9]{0,18}$' then
    raise exception 'Invalid payout request' using errcode = '22023';
  end if;
  select * into v_affiliate from public.affiliates where user_id = auth.uid() and status = 'approved';
  if not found then raise exception 'Approved affiliate required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('payouts.affiliate:' || v_affiliate.id::text, 0));
  select * into v_existing from payouts.payout_requests where request_key = p_request_key;
  if found then
    if v_existing.affiliate_id = v_affiliate.id and v_existing.currency = p_currency
      and v_existing.amount_minor = p_amount_minor then return v_existing.id; end if;
    raise exception 'Request key already used for different content' using errcode = '22023';
  end if;
  select * into v_policy from public.program_policies
  where currency = p_currency order by version desc limit 1;
  if not found then raise exception 'No published policy for currency' using errcode = '22023'; end if;
  if p_amount_minor::numeric < payouts.minimum_minor(v_policy.minimum_payout, v_policy.currency_decimals) then
    raise exception 'Amount below the published minimum payout' using errcode = '22023';
  end if;
  v_payable := payouts.ensure_account(v_affiliate.id, p_currency, v_policy.currency_decimals, 'payable');
  v_reserved := payouts.ensure_account(v_affiliate.id, p_currency, v_policy.currency_decimals, 'reserved');
  if payouts.account_balance(v_payable) < p_amount_minor::numeric then
    raise exception 'Insufficient payable balance' using errcode = '22023';
  end if;
  insert into payouts.payout_requests(request_key, affiliate_id, currency, exponent, amount_minor)
  values (p_request_key, v_affiliate.id, p_currency, v_policy.currency_decimals, p_amount_minor)
  returning id into v_id;
  perform payouts.move('payout:' || p_request_key || ':reserve', p_currency, v_policy.currency_decimals,
    'Payout ' || p_request_key || ' reserved pending administrator review',
    v_payable, v_reserved, p_amount_minor);
  insert into payouts.payout_events(request_id, actor_id, kind) values (v_id, auth.uid(), 'requested');
  return v_id;
end;
$$;

-- Cancel an own still-requested payout; the reservation is released back
-- to payable. Re-cancelling a cancelled request is an idempotent no-op.
create function public.cancel_payout(p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_request payouts.payout_requests%rowtype; v_payable uuid; v_reserved uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_request_id is null then raise exception 'Invalid payout request' using errcode = '22023'; end if;
  select * into v_request from payouts.payout_requests where id = p_request_id;
  if not found or not exists(select 1 from public.affiliates
    where id = v_request.affiliate_id and user_id = auth.uid()) then
    raise exception 'Payout request not available' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('payouts.affiliate:' || v_request.affiliate_id::text, 0));
  select * into v_request from payouts.payout_requests where id = p_request_id;
  if v_request.status = 'cancelled' then return; end if;
  if v_request.status <> 'requested' then
    raise exception 'Only a requested payout can be cancelled' using errcode = '22023';
  end if;
  v_payable := payouts.ensure_account(v_request.affiliate_id, v_request.currency, v_request.exponent, 'payable');
  v_reserved := payouts.ensure_account(v_request.affiliate_id, v_request.currency, v_request.exponent, 'reserved');
  perform payouts.move('payout:' || v_request.request_key || ':release', v_request.currency, v_request.exponent,
    'Payout ' || v_request.request_key || ' cancelled by affiliate; reservation released',
    v_reserved, v_payable, v_request.amount_minor);
  update payouts.payout_requests set status = 'cancelled' where id = v_request.id;
  insert into payouts.payout_events(request_id, actor_id, kind) values (v_request.id, auth.uid(), 'cancelled');
end;
$$;

-- Administrator review (AAL2). Maker-checker: the reviewer can never be
-- the requesting affiliate's user. Approval moves no money (funds stay
-- reserved); rejection releases the reservation to payable.
create function public.review_payout(p_request_id uuid, p_decision text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_request payouts.payout_requests%rowtype; v_payable uuid; v_reserved uuid;
begin
  perform payouts.require_admin();
  if p_request_id is null or p_decision is null or p_decision not in ('approve', 'reject')
  or p_reason is null or char_length(btrim(p_reason)) not between 3 and 1000 then
    raise exception 'Invalid payout review' using errcode = '22023';
  end if;
  select * into v_request from payouts.payout_requests where id = p_request_id;
  if not found then raise exception 'Payout request not found' using errcode = '22023'; end if;
  if exists(select 1 from public.affiliates where id = v_request.affiliate_id and user_id = auth.uid()) then
    raise exception 'Reviewer cannot be the requesting affiliate' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('payouts.affiliate:' || v_request.affiliate_id::text, 0));
  select * into v_request from payouts.payout_requests where id = p_request_id;
  if (p_decision = 'approve' and v_request.status = 'approved')
  or (p_decision = 'reject' and v_request.status = 'rejected') then return; end if;
  if v_request.status <> 'requested' then
    raise exception 'Only a requested payout can be reviewed' using errcode = '22023';
  end if;
  if p_decision = 'reject' then
    v_payable := payouts.ensure_account(v_request.affiliate_id, v_request.currency, v_request.exponent, 'payable');
    v_reserved := payouts.ensure_account(v_request.affiliate_id, v_request.currency, v_request.exponent, 'reserved');
    perform payouts.move('payout:' || v_request.request_key || ':release', v_request.currency, v_request.exponent,
      'Payout ' || v_request.request_key || ' rejected; reservation released',
      v_reserved, v_payable, v_request.amount_minor);
  end if;
  update payouts.payout_requests
  set status = case when p_decision = 'approve' then 'approved' else 'rejected' end
  where id = v_request.id;
  insert into payouts.payout_events(request_id, actor_id, kind, detail)
  values (v_request.id, auth.uid(), case when p_decision = 'approve' then 'approved' else 'rejected' end, btrim(p_reason));
end;
$$;

-- Record manual settlement (AAL2, maker-checker). The administrator has
-- ALREADY sent the money outside this system; this function only records
-- that fact with its external reference and moves reserved -> clearing.
-- Settling twice with the same reference is an idempotent no-op; a
-- different reference for a settled request is a conflict.
create function public.settle_payout(p_request_id uuid, p_external_reference text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_request payouts.payout_requests%rowtype; v_reserved uuid; v_clearing uuid;
begin
  perform payouts.require_admin();
  if p_request_id is null or p_external_reference is null
  or char_length(btrim(p_external_reference)) not between 4 and 120 then
    raise exception 'A settlement reference is required' using errcode = '22023';
  end if;
  select * into v_request from payouts.payout_requests where id = p_request_id;
  if not found then raise exception 'Payout request not found' using errcode = '22023'; end if;
  if exists(select 1 from public.affiliates where id = v_request.affiliate_id and user_id = auth.uid()) then
    raise exception 'Settler cannot be the requesting affiliate' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('payouts.affiliate:' || v_request.affiliate_id::text, 0));
  select * into v_request from payouts.payout_requests where id = p_request_id;
  if v_request.status = 'settled' then
    if v_request.external_reference = btrim(p_external_reference) then return; end if;
    raise exception 'Payout already settled with a different reference' using errcode = '22023';
  end if;
  if v_request.status <> 'approved' then
    raise exception 'Only an approved payout can be settled' using errcode = '22023';
  end if;
  v_reserved := payouts.ensure_account(v_request.affiliate_id, v_request.currency, v_request.exponent, 'reserved');
  v_clearing := payouts.ensure_account(null, v_request.currency, v_request.exponent, 'clearing');
  perform payouts.move('payout:' || v_request.request_key || ':settle', v_request.currency, v_request.exponent,
    'Payout ' || v_request.request_key || ' settled manually; external reference recorded',
    v_reserved, v_clearing, v_request.amount_minor);
  update payouts.payout_requests
  set status = 'settled', external_reference = btrim(p_external_reference) where id = v_request.id;
  insert into payouts.payout_events(request_id, actor_id, kind, detail)
  values (v_request.id, auth.uid(), 'settled', btrim(p_external_reference));
end;
$$;

-- Record that an approved payout's external transfer failed (AAL2,
-- maker-checker). The reservation is released to payable so the affiliate
-- can request again; the reason is kept on the request and in the events.
create function public.fail_payout(p_request_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_request payouts.payout_requests%rowtype; v_payable uuid; v_reserved uuid;
begin
  perform payouts.require_admin();
  if p_request_id is null or p_reason is null or char_length(btrim(p_reason)) not between 3 and 1000 then
    raise exception 'Invalid payout failure' using errcode = '22023';
  end if;
  select * into v_request from payouts.payout_requests where id = p_request_id;
  if not found then raise exception 'Payout request not found' using errcode = '22023'; end if;
  if exists(select 1 from public.affiliates where id = v_request.affiliate_id and user_id = auth.uid()) then
    raise exception 'Reviewer cannot be the requesting affiliate' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('payouts.affiliate:' || v_request.affiliate_id::text, 0));
  select * into v_request from payouts.payout_requests where id = p_request_id;
  if v_request.status = 'failed' then return; end if;
  if v_request.status <> 'approved' then
    raise exception 'Only an approved payout can be marked failed' using errcode = '22023';
  end if;
  v_payable := payouts.ensure_account(v_request.affiliate_id, v_request.currency, v_request.exponent, 'payable');
  v_reserved := payouts.ensure_account(v_request.affiliate_id, v_request.currency, v_request.exponent, 'reserved');
  perform payouts.move('payout:' || v_request.request_key || ':release', v_request.currency, v_request.exponent,
    'Payout ' || v_request.request_key || ' transfer failed; reservation released',
    v_reserved, v_payable, v_request.amount_minor);
  update payouts.payout_requests set status = 'failed', failure_reason = btrim(p_reason) where id = v_request.id;
  insert into payouts.payout_events(request_id, actor_id, kind, detail)
  values (v_request.id, auth.uid(), 'failed', btrim(p_reason));
end;
$$;

-- Affiliate-safe overview: only the caller's own affiliate contributes.
-- Balances are exact minor-unit TEXT derived from ledger lines; minimum
-- payout and cadence come from the latest published policy per currency
-- (null when no policy covers that currency, in which case requests are
-- denied by request_payout). Requests are the caller's latest twenty.
create function public.affiliate_payout_overview()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_affiliate public.affiliates%rowtype;
  v_currencies jsonb := '[]'::jsonb;
  v_requests jsonb := '[]'::jsonb;
  v_currency text; v_policy public.program_policies%rowtype;
  v_payable uuid; v_reserved uuid; v_exponent integer;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v_affiliate from public.affiliates where user_id = auth.uid();
  if not found then return jsonb_build_object('currencies', v_currencies, 'requests', v_requests); end if;
  for v_currency in
    select currency from (
      select distinct currency from ledger.accounts where affiliate_id = v_affiliate.id
      union
      select currency from public.program_policies
      where version = (select max(version) from public.program_policies)
    ) known order by currency
  loop
    select * into v_policy from public.program_policies
    where currency = v_currency order by version desc limit 1;
    select id into v_payable from ledger.accounts
    where affiliate_id = v_affiliate.id and currency = v_currency and bucket = 'payable';
    select id into v_reserved from ledger.accounts
    where affiliate_id = v_affiliate.id and currency = v_currency and bucket = 'reserved';
    select exponent into v_exponent from ledger.accounts
    where affiliate_id = v_affiliate.id and currency = v_currency limit 1;
    v_currencies := v_currencies || jsonb_build_object(
      'currency', v_currency,
      'exponent', coalesce(v_exponent, v_policy.currency_decimals),
      'payableMinor', case when v_payable is null then '0'
        else payouts.account_balance(v_payable)::bigint::text end,
      'reservedMinor', case when v_reserved is null then '0'
        else payouts.account_balance(v_reserved)::bigint::text end,
      'minimumPayoutMinor', case when v_policy.version is null then null
        else payouts.minimum_minor(v_policy.minimum_payout, v_policy.currency_decimals)::bigint::text end,
      'payoutCadence', v_policy.payout_cadence);
  end loop;
  select coalesce(jsonb_agg(row_data order by created_at desc, id desc), '[]'::jsonb) into v_requests from (
    select jsonb_build_object(
      'id', r.id::text, 'requestKey', r.request_key, 'currency', r.currency,
      'amountMinor', r.amount_minor, 'status', r.status,
      'externalReference', r.external_reference, 'failureReason', r.failure_reason,
      'createdAt', to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) as row_data,
      r.created_at, r.id
    from payouts.payout_requests r where r.affiliate_id = v_affiliate.id
    order by r.created_at desc, r.id desc limit 20
  ) latest;
  return jsonb_build_object('currencies', v_currencies, 'requests', v_requests);
end;
$$;

-- Administrator queue (AAL2): payouts awaiting review or settlement,
-- oldest first, with the affiliate display identity held in-schema.
create function public.admin_payout_queue()
returns table(id uuid, request_key text, affiliate_id uuid, affiliate_user_id uuid,
  display_name text, currency text, amount_minor text, status text,
  external_reference text, failure_reason text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  perform payouts.require_admin();
  return query
  select r.id, r.request_key, r.affiliate_id, a.user_id,
    coalesce(p.display_name, aa.display_name, 'Affiliate'), r.currency, r.amount_minor,
    r.status, r.external_reference, r.failure_reason, r.created_at
  from payouts.payout_requests r
  join public.affiliates a on a.id = r.affiliate_id
  left join public.profiles p on p.id = a.user_id
  left join public.affiliate_applications aa on aa.user_id = a.user_id
  where r.status in ('requested', 'approved')
  order by r.created_at asc, r.id asc;
end;
$$;

revoke all on function public.request_payout(text, text, text),
  public.cancel_payout(uuid),
  public.review_payout(uuid, text, text),
  public.settle_payout(uuid, text),
  public.fail_payout(uuid, text),
  public.affiliate_payout_overview(),
  public.admin_payout_queue()
from public, anon, authenticated, service_role;
grant execute on function public.request_payout(text, text, text) to authenticated;
grant execute on function public.cancel_payout(uuid) to authenticated;
grant execute on function public.review_payout(uuid, text, text) to authenticated;
grant execute on function public.settle_payout(uuid, text) to authenticated;
grant execute on function public.fail_payout(uuid, text) to authenticated;
grant execute on function public.affiliate_payout_overview() to authenticated;
grant execute on function public.admin_payout_queue() to authenticated;
commit;
