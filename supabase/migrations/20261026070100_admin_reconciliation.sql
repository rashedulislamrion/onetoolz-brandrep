-- SOURCE-ONLY. Not installed anywhere. Depends on the ledger foundation
-- (20261015135651), commission calculations (20261026020100) with
-- revision chains (20261026050000) and payouts (20261026060000).
-- Phase 6: administrator reconciliation overview (admin + AAL2).
--
-- THE INVARIANT. Tracing every journal flow built in Phases 4-5, with
-- balances stated as credits - debits over ledger.lines:
--   commission earn      Dr platform expense / Cr affiliate held
--   commission reversal  Dr affiliate held   / Cr platform expense
--   hold release         Dr affiliate held   / Cr affiliate payable
--   payout reserve       Dr affiliate payable / Cr affiliate reserved
--   payout release       Dr affiliate reserved / Cr affiliate payable
--   payout settle        Dr affiliate reserved / Cr platform clearing
-- Platform expense is the single debit-balance SOURCE of commission value
-- and the only destinations are the affiliate buckets (held, payable,
-- reserved, disputed, recovery) and platform clearing. Releases, reserves
-- and settlements only move value between destinations; reversals return
-- it to the source. Therefore, per currency:
--   (debits - credits on expense) == held + payable + reserved
--     + disputed + recovery + clearing      (all as credits - debits)
-- and differenceMinor must be exactly "0". Any journal outside these
-- flows that funds affiliate buckets or clearing from a non-expense
-- source (or drains expense without crediting a destination) breaks the
-- identity and MUST surface here as a mismatch — that is the point of
-- the check. Dispute/recovery buckets are inside the destination sum so
-- Phase 4/5-style dispute movements stay reconciled if added later.
--
-- Amounts are exact minor-unit TEXT. Calculation counts cover HEAD rows
-- only (superseded revisions are history, not current records), matching
-- affiliate_commission_totals(). Payout counts cover every request row
-- by status for the currency. Returned as one JSONB document, following
-- the affiliate_payout_overview() precedent, so the reader maps it
-- atomically and fails closed on any drift.
begin;
create function public.admin_reconciliation_overview()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_currencies jsonb := '[]'::jsonb;
  v_currency text;
  v_exponent integer;
  v_expense numeric; v_held numeric; v_payable numeric; v_reserved numeric;
  v_disputed numeric; v_recovery numeric; v_clearing numeric;
  v_destination numeric;
  v_calculations jsonb;
  v_payouts jsonb;
begin
  if auth.uid() is null or (auth.jwt()->>'aal') is distinct from 'aal2' or not exists(
    select 1 from public.user_roles where user_id = auth.uid() and role = 'admin'
  ) then raise exception 'Administrator MFA required' using errcode = '42501'; end if;

  for v_currency in
    select currency from (
      select distinct currency from ledger.accounts
      union
      select distinct currency from commissions.calculations
      union
      select distinct currency from payouts.payout_requests
    ) known order by currency
  loop
    select coalesce(
      (select exponent from ledger.accounts where currency = v_currency limit 1),
      (select currency_decimals from commissions.calculations
        where currency = v_currency order by created_at desc limit 1),
      (select exponent from payouts.payout_requests
        where currency = v_currency order by created_at desc limit 1))
    into v_exponent;

    select coalesce(sum(l.credit_minor - l.debit_minor), 0) into v_expense
    from ledger.accounts a left join ledger.lines l on l.account_id = a.id
    where a.currency = v_currency and a.bucket = 'expense';
    select coalesce(sum(l.credit_minor - l.debit_minor), 0) into v_held
    from ledger.accounts a left join ledger.lines l on l.account_id = a.id
    where a.currency = v_currency and a.bucket = 'held';
    select coalesce(sum(l.credit_minor - l.debit_minor), 0) into v_payable
    from ledger.accounts a left join ledger.lines l on l.account_id = a.id
    where a.currency = v_currency and a.bucket = 'payable';
    select coalesce(sum(l.credit_minor - l.debit_minor), 0) into v_reserved
    from ledger.accounts a left join ledger.lines l on l.account_id = a.id
    where a.currency = v_currency and a.bucket = 'reserved';
    select coalesce(sum(l.credit_minor - l.debit_minor), 0) into v_disputed
    from ledger.accounts a left join ledger.lines l on l.account_id = a.id
    where a.currency = v_currency and a.bucket = 'disputed';
    select coalesce(sum(l.credit_minor - l.debit_minor), 0) into v_recovery
    from ledger.accounts a left join ledger.lines l on l.account_id = a.id
    where a.currency = v_currency and a.bucket = 'recovery';
    select coalesce(sum(l.credit_minor - l.debit_minor), 0) into v_clearing
    from ledger.accounts a left join ledger.lines l on l.account_id = a.id
    where a.currency = v_currency and a.bucket = 'clearing';

    v_destination := v_held + v_payable + v_reserved + v_disputed + v_recovery + v_clearing;

    select coalesce(jsonb_agg(entry order by entry->>'qualification'), '[]'::jsonb)
    into v_calculations from (
      select jsonb_build_object(
        'qualification', qualification,
        'count', count(*)::text,
        'netMinor', coalesce(sum(net_minor::numeric), 0)::bigint::text) as entry
      from commissions.calculations
      where currency = v_currency and superseded_by_id is null
      group by qualification
    ) grouped;

    select coalesce(jsonb_agg(entry order by entry->>'status'), '[]'::jsonb)
    into v_payouts from (
      select jsonb_build_object(
        'status', status,
        'count', count(*)::text,
        'amountMinor', coalesce(sum(amount_minor::numeric), 0)::bigint::text) as entry
      from payouts.payout_requests
      where currency = v_currency
      group by status
    ) grouped;

    v_currencies := v_currencies || jsonb_build_object(
      'currency', v_currency,
      'exponent', v_exponent,
      'expenseDebitsMinor', (-v_expense)::bigint::text,
      'heldMinor', v_held::bigint::text,
      'payableMinor', v_payable::bigint::text,
      'reservedMinor', v_reserved::bigint::text,
      'disputedMinor', v_disputed::bigint::text,
      'recoveryMinor', v_recovery::bigint::text,
      'clearingMinor', v_clearing::bigint::text,
      'destinationTotalMinor', v_destination::bigint::text,
      'differenceMinor', (-v_expense - v_destination)::bigint::text,
      'calculations', v_calculations,
      'payouts', v_payouts);
  end loop;
  return jsonb_build_object('currencies', v_currencies);
end;
$$;
revoke all on function public.admin_reconciliation_overview()
from public, anon, authenticated, service_role;
grant execute on function public.admin_reconciliation_overview() to authenticated;
commit;
