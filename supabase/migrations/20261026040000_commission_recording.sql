-- SOURCE-ONLY. Not installed anywhere. Depends on the Woo ingestion
-- migration (woo.orders), the referral evidence migration
-- (referral.order_decisions), the policy publication migration
-- (public.program_policies), 20261026020000 (policy rounding/qualification)
-- and 20261026020100 (commissions.calculations).
-- Commission recording surfaces for the Phase 4 recording worker. The
-- private woo / referral / commissions schemas stay closed to every
-- application role; the worker (service_role) reaches them only through
-- the two narrow security-definer read RPCs below.
--
-- The worker's universe is orders that carry a referral decision: the
-- decision row is the only validated source of the order's creation time
-- (order_at) — the stored Woo snapshot intentionally carries none — and
-- attribution exists only as a decision outcome. Orders without a
-- decision can never produce a calculation, so they are not scanned.
--
-- Recorded orders are resurfaced ONLY as recheck candidates, when the
-- stored snapshot's own modified time is newer than the calculation:
-- commissions.calculations is append-only with unique
-- (order_id, policy_version), so a drifted state can never be re-recorded
-- in place; the worker counts the drift and the posting worker's
-- credited == recorded-net invariant remains the only monetary handler.
begin;

-- Recording scan: decided orders with no calculation yet, plus recorded
-- orders whose snapshot moved after recording (recheck candidates),
-- oldest decision first. Snapshot is returned as stored; the worker
-- re-validates the stored contract in TypeScript before trusting it.
create function public.list_orders_for_commission_recording(
 p_limit integer default 50)
returns table(order_id text, order_at text, outcome text, affiliate_id uuid,
 snapshot jsonb, calc_basis text, calc_currency_decimals integer,
 calc_refunded_basis_minor text, calc_qualification text,
 calc_policy_version integer)
language plpgsql security definer set search_path='' as $$
begin
 if p_limit is null or p_limit not between 1 and 200 then
  raise exception 'Invalid recording scan' using errcode='22023';
 end if;
 return query
 select o.order_id::text,
  to_char(d.order_at at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  d.outcome, d.affiliate_id, o.snapshot,
  c.basis, c.currency_decimals, c.refunded_basis_minor, c.qualification,
  c.policy_version
 from referral.order_decisions d
 join woo.orders o on o.order_id=d.order_id
 left join lateral (
  select cc.basis, cc.currency_decimals, cc.refunded_basis_minor,
   cc.qualification, cc.policy_version, cc.created_at
  from commissions.calculations cc
  where cc.order_id=d.order_id::text
  order by cc.policy_version desc limit 1
 ) c on true
 where c.basis is null or o.source_modified_at>c.created_at
 order by d.order_at asc, d.order_id asc
 limit p_limit;
end;
$$;

-- Complete published policy history for the recording worker. The pure
-- engine's policyForOrder requires the COMPLETE history (sequential
-- versions, no gaps) and fails closed without it, so this returns every
-- row, oldest version first — never the admin page's ten-row preview.
-- hold_days and minimum_payout are read from the immutable published row
-- itself: publication copies them from the draft, so hold semantics are
-- versioned with the policy and drafts are never consulted by workers.
-- rounding/qualification are nullable: rows published before
-- 20261026020000 carry NULL and the engine rejects them as invalid
-- policies (fail closed) rather than assuming a rule.
create function public.list_program_policies_for_recording()
returns table(version integer, effective_at text, commission_bps integer,
 currency text, currency_decimals integer, minimum_payout text,
 hold_days integer, basis text, refund_rule text, scope text,
 rounding text, qualification text)
language plpgsql security definer set search_path='' as $$
begin
 return query
 select p.version,
  to_char(p.effective_at at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  p.commission_bps, p.currency, p.currency_decimals, p.minimum_payout,
  p.hold_days, p.basis, p.refund_rule, p.scope, p.rounding, p.qualification
 from public.program_policies p
 order by p.version asc;
end;
$$;

revoke all on function public.list_orders_for_commission_recording(integer),
 public.list_program_policies_for_recording() from public,anon,authenticated,service_role;
grant execute on function public.list_orders_for_commission_recording(integer) to service_role;
grant execute on function public.list_program_policies_for_recording() to service_role;
commit;
