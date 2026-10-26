-- SOURCE-ONLY. Not installed anywhere. Depends on the identity migration
-- (public.affiliates) and the ledger foundation (20261015135651).
-- Phase 6: affiliate-safe ledger balance reads. Balances are derived from
-- ledger.lines (credits - debits per account, the liability convention
-- used by every Phase 4/5 balance derivation; the ledger has no balance
-- view). Only the caller's OWN affiliate accounts contribute: platform
-- accounts (expense/clearing, affiliate_id null) are structurally
-- unreachable because affiliate buckets exist only on affiliate accounts
-- (foundation check constraint). An account that exists with no journal
-- lines reports an exact "0" — a fact, not an invented reading. An
-- affiliate with no ledger accounts gets an EMPTY set: currencies are
-- never fabricated for accounts that do not exist.
begin;
create function public.affiliate_ledger_balances()
returns table(currency text, exponent integer, bucket text, balance_minor text)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  return query
  select a.currency, a.exponent, a.bucket,
    coalesce(sum(l.credit_minor - l.debit_minor), 0)::bigint::text
  from ledger.accounts a
  left join ledger.lines l on l.account_id = a.id
  where a.affiliate_id = (select id from public.affiliates where user_id = auth.uid())
  group by a.currency, a.exponent, a.bucket
  order by a.currency, a.bucket;
end;
$$;
revoke all on function public.affiliate_ledger_balances()
from public, anon, authenticated, service_role;
grant execute on function public.affiliate_ledger_balances() to authenticated;
commit;
