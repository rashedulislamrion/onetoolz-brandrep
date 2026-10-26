-- SOURCE-ONLY. Not installed anywhere. Depends on the ledger foundation
-- (20261015135651), identity (public.affiliates) and
-- 20261026020100_commission_calculations.sql.
-- Commission posting surfaces for the Phase 4 posting worker. The private
-- ledger and commissions schemas stay closed to every application role;
-- the worker (service_role) reaches them only through the narrow
-- security-definer RPCs below. Security-definer functions here are owned
-- by the migration role (postgres), so the nested ledger.post_journal call
-- sees current_user = 'postgres' and passes that function's operator-only
-- check; service_role itself still cannot call ledger.post_journal or
-- touch ledger/commissions tables directly.
--
-- Ledger account model (foundation): ledger.accounts is keyed by
-- (affiliate_id, currency, bucket) with buckets expense/clearing for the
-- platform (affiliate_id null) and held/payable/reserved/disputed/recovery
-- per affiliate. Commissions use expense (platform) + held + payable per
-- affiliate; the foundation's "payable" bucket is the available balance
-- (held -> payable is the hold release).
begin;

-- Worker scan indexes: qualification queue order and due-release scans.
create index commissions_calculations_queue
 on commissions.calculations(qualification, created_at, id);
create index commissions_calculations_due
 on commissions.calculations(hold_until)
 where qualification='qualified' and hold_until is not null;

-- Account provisioning: get-or-create the three commission accounts for one
-- affiliate + currency. The platform expense account is a per-currency
-- singleton shared by every affiliate. Serialized per currency so two
-- affiliates provisioning concurrently cannot race the shared expense row.
create function public.get_or_create_commission_accounts(
 p_affiliate_id uuid, p_currency text, p_exponent integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_expense uuid; v_held uuid; v_payable uuid;
begin
 if p_affiliate_id is null or p_currency is null or p_currency !~ '^[A-Z]{3}$'
 or p_exponent is null or p_exponent not between 0 and 6 then
  raise exception 'Invalid commission account request' using errcode='22023';
 end if;
 if not exists(select 1 from public.affiliates where id=p_affiliate_id) then
  raise exception 'Unknown affiliate' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('commission.accounts:'||p_currency,0));
 insert into ledger.currencies(code,exponent) values(p_currency,p_exponent)
 on conflict(code) do nothing;
 if not exists(select 1 from ledger.currencies where code=p_currency and exponent=p_exponent) then
  raise exception 'Currency exponent mismatch' using errcode='22023';
 end if;
 insert into ledger.accounts(affiliate_id,currency,exponent,bucket)
 values(null,p_currency,p_exponent,'expense')
 on conflict(affiliate_id,currency,bucket) do nothing;
 insert into ledger.accounts(affiliate_id,currency,exponent,bucket)
 values(p_affiliate_id,p_currency,p_exponent,'held')
 on conflict(affiliate_id,currency,bucket) do nothing;
 insert into ledger.accounts(affiliate_id,currency,exponent,bucket)
 values(p_affiliate_id,p_currency,p_exponent,'payable')
 on conflict(affiliate_id,currency,bucket) do nothing;
 select id into v_expense from ledger.accounts
  where affiliate_id is null and currency=p_currency and bucket='expense';
 select id into v_held from ledger.accounts
  where affiliate_id=p_affiliate_id and currency=p_currency and bucket='held';
 select id into v_payable from ledger.accounts
  where affiliate_id=p_affiliate_id and currency=p_currency and bucket='payable';
 if v_expense is null or v_held is null or v_payable is null then
  raise exception 'Commission account provisioning failed' using errcode='22023';
 end if;
 return jsonb_build_object('expenseAccountId',v_expense,'heldAccountId',v_held,'payableAccountId',v_payable);
end;
$$;

-- Journal posting surface: commission namespace only. Delta refund
-- reversals are standalone journals under their own effect keys; the
-- foundation's journals.reverses link requires an EXACT full compensation
-- of one source journal, which a partial cumulative delta never is, so
-- p_reverses is deliberately never accepted through this surface.
create function public.post_commission_journal(p_journal jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
begin
 if p_journal is null or jsonb_typeof(p_journal) is distinct from 'object'
 or jsonb_typeof(p_journal->'effectKey') is distinct from 'string'
 or (p_journal->>'effectKey') not like 'commission:%' then
  raise exception 'Commission journal namespace required' using errcode='22023';
 end if;
 return ledger.post_journal(p_journal, null);
end;
$$;

-- Bounded worker scan over recorded calculations, oldest first. Filters are
-- allow-listed; p_due_before restricts to calculations whose hold has
-- matured (release queue).
create function public.list_commission_calculations(
 p_qualification text default null, p_due_before timestamptz default null,
 p_limit integer default 50)
returns table(id uuid, effect_key text, order_id text, affiliate_id uuid,
 policy_version integer, currency text, currency_decimals integer, basis text,
 refund_rule text, rounding text, basis_minor text, refunded_basis_minor text,
 gross_minor text, reversal_minor text, net_minor text, qualification text,
 unqualified_reason text, hold_until timestamptz, status text, created_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
 if (p_qualification is not null and p_qualification not in ('qualified','unqualified'))
 or p_limit is null or p_limit not between 1 and 200 then
  raise exception 'Invalid calculation scan' using errcode='22023';
 end if;
 return query
 select c.id, c.effect_key, c.order_id, c.affiliate_id, c.policy_version,
  c.currency, c.currency_decimals, c.basis, c.refund_rule, c.rounding,
  c.basis_minor, c.refunded_basis_minor, c.gross_minor, c.reversal_minor,
  c.net_minor, c.qualification, c.unqualified_reason, c.hold_until, c.status,
  c.created_at
 from commissions.calculations c
 where (p_qualification is null or c.qualification=p_qualification)
 and (p_due_before is null or (c.hold_until is not null and c.hold_until<=p_due_before))
 order by c.created_at asc, c.id asc
 limit p_limit;
end;
$$;

-- Posted-state probe for one calculation effect key. Earn amount and posted
-- reversal totals are summed from journal LINES (debits equal the journal
-- amount for these balanced two-line journals); refund journals live under
-- the '<effect_key>:refund:' prefix and the release under ':release'.
create function public.commission_posting_state(p_effect_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_earn uuid; v_earn_minor text; v_reversal_minor text; v_release uuid;
begin
 if p_effect_key is null or p_effect_key !~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{2,199}$' then
  raise exception 'Invalid effect key' using errcode='22023';
 end if;
 select j.id, coalesce(sum(l.debit_minor),0)::bigint::text into v_earn, v_earn_minor
 from ledger.journals j left join ledger.lines l on l.journal_id=j.id
 where j.effect_key=p_effect_key group by j.id;
 select coalesce(sum(amount),0)::bigint::text into v_reversal_minor from (
  select (select coalesce(sum(l2.debit_minor),0) from ledger.lines l2
   where l2.journal_id=j2.id) as amount
  from ledger.journals j2
  where starts_with(j2.effect_key, p_effect_key||':refund:')) posted;
 select j.id into v_release from ledger.journals j where j.effect_key=p_effect_key||':release';
 return jsonb_build_object('earnJournalId',v_earn,'earnMinor',v_earn_minor,
  'reversalPostedMinor',coalesce(v_reversal_minor,'0'),'releaseJournalId',v_release);
end;
$$;

revoke all on function public.get_or_create_commission_accounts(uuid,text,integer),
 public.post_commission_journal(jsonb),
 public.list_commission_calculations(text,timestamptz,integer),
 public.commission_posting_state(text) from public,anon,authenticated,service_role;
grant execute on function public.get_or_create_commission_accounts(uuid,text,integer) to service_role;
grant execute on function public.post_commission_journal(jsonb) to service_role;
grant execute on function public.list_commission_calculations(text,timestamptz,integer) to service_role;
grant execute on function public.commission_posting_state(text) to service_role;
commit;
