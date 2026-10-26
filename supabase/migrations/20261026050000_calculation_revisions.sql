-- SOURCE-ONLY. Not installed anywhere. Depends on
-- 20261026020100_commission_calculations.sql (table + record/totals RPCs),
-- 20261026030000_commission_posting.sql (posting read RPCs) and
-- 20261026040000_commission_recording.sql (recording scan RPC).
-- Calculation REVISIONS (supersede support). commissions.calculations
-- stays append-only — no recorded row is ever updated in content or
-- deleted — but a recorded state may now be REPLACED by a new row when
-- the underlying evidence drifts (a refund grows, or qualification flips
-- after an order completes). The replacement forms a chain:
--
--   rev 1 (superseded_by_id -> rev 2) <-supersedes_id- rev 2 (head)
--
-- Exactly one row per (order_id, policy_version) is the HEAD
-- (superseded_by_id is null), enforced by a partial unique index. Every
-- reader (totals, posting scan, recording recheck) sees heads only.
-- The single permitted UPDATE in the whole schema is the one-way
-- supersede mark (superseded_by_id null -> new row id) on the old head,
-- performed only by record_commission_calculation and guarded by a
-- row-level trigger mirroring referral.guard_store_link_change.
--
-- Money safety: a head that already has ledger journals (earn, :refund:
-- or :release under its effect-key namespace) can NEVER be superseded —
-- the RPC raises SQLSTATE 55000 (object_not_in_prerequisite_state).
-- Money already moved is handled by the posting worker's
-- credited == recorded-net invariant, never by rewriting history.
begin;

-- Chain columns. The self-referencing FKs are DEFERRABLE so the record
-- RPC can mark the old head with the new row's id before inserting it,
-- inside one transaction, without tripping the head index or the FK.
alter table commissions.calculations
 add column revision integer not null default 1 check(revision>=1),
 add column supersedes_id uuid
  references commissions.calculations(id) on delete restrict
  deferrable initially deferred,
 add column superseded_by_id uuid
  references commissions.calculations(id) on delete restrict
  deferrable initially deferred;
alter table commissions.calculations
 drop constraint if exists calculations_order_id_policy_version_key,
 add constraint calculations_order_policy_revision_key
  unique(order_id, policy_version, revision);
create unique index commissions_calculations_head
 on commissions.calculations(order_id, policy_version)
 where superseded_by_id is null;

-- Append-only, refined: DELETE/TRUNCATE keep the statement-level reject;
-- UPDATE is permitted only as the one-way supersede mark.
drop trigger calculations_immutable on commissions.calculations;
create trigger calculations_reject_delete before delete or truncate
 on commissions.calculations
 for each statement execute function commissions.reject_change();
create function commissions.guard_calculation_update() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if OLD.superseded_by_id is not null or NEW.superseded_by_id is null
 or NEW.superseded_by_id = OLD.id
 or NEW.id is distinct from OLD.id
 or NEW.effect_key is distinct from OLD.effect_key
 or NEW.order_id is distinct from OLD.order_id
 or NEW.affiliate_id is distinct from OLD.affiliate_id
 or NEW.policy_version is distinct from OLD.policy_version
 or NEW.currency is distinct from OLD.currency
 or NEW.currency_decimals is distinct from OLD.currency_decimals
 or NEW.basis is distinct from OLD.basis
 or NEW.refund_rule is distinct from OLD.refund_rule
 or NEW.rounding is distinct from OLD.rounding
 or NEW.basis_minor is distinct from OLD.basis_minor
 or NEW.refunded_basis_minor is distinct from OLD.refunded_basis_minor
 or NEW.gross_minor is distinct from OLD.gross_minor
 or NEW.reversal_minor is distinct from OLD.reversal_minor
 or NEW.net_minor is distinct from OLD.net_minor
 or NEW.qualification is distinct from OLD.qualification
 or NEW.unqualified_reason is distinct from OLD.unqualified_reason
 or NEW.hold_until is distinct from OLD.hold_until
 or NEW.status is distinct from OLD.status
 or NEW.created_at is distinct from OLD.created_at
 or NEW.revision is distinct from OLD.revision
 or NEW.supersedes_id is distinct from OLD.supersedes_id
 then raise exception 'Commission calculations permit only the one-way supersede mark'
  using errcode='42501';
 end if;
 return NEW;
end;
$$;
create trigger calculations_guard_update before update
 on commissions.calculations
 for each row execute function commissions.guard_calculation_update();
revoke all on function commissions.guard_calculation_update()
 from public, anon, authenticated, service_role;

-- record_commission_calculation v2. Same name/signature and the same
-- jsonb payload contract, plus ONE optional key: "supersedesEffectKey".
-- Without it, behavior is exactly v1 (idempotent on effect_key, a second
-- row for the same order+policy is a 22023 conflict). With it, the
-- payload is a REVISION of the current head for (orderId, policyVersion):
-- the head's effect key must equal supersedesEffectKey, identity fields
-- (affiliate, currency, decimals, basis, refund rule, rounding) must
-- match the head, at least one material field (qualification, reason,
-- basis/refunded/gross/reversal/net minors, hold_until) must differ,
-- and the head must have no posted journals (else 55000). The new row's
-- effectKey must be new (the worker derives "<base>:r<revision+1>").
create or replace function public.record_commission_calculation(p jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_existing commissions.calculations%rowtype;
 v_head commissions.calculations%rowtype; v_id uuid; v_supersedes text;
begin
 if p is null or jsonb_typeof(p) is distinct from 'object'
 or jsonb_typeof(p->'effectKey') is distinct from 'string' or (p->>'effectKey') !~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{2,199}$'
 or jsonb_typeof(p->'orderId') is distinct from 'string' or (p->>'orderId') !~ '^[1-9][0-9]{0,15}$'
 or jsonb_typeof(p->'affiliateId') is distinct from 'string'
   or (p->>'affiliateId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 or jsonb_typeof(p->'policyVersion') is distinct from 'number' or (p->>'policyVersion') !~ '^[1-9][0-9]{0,8}$'
 or jsonb_typeof(p->'currency') is distinct from 'string' or (p->>'currency') !~ '^[A-Z]{3}$'
 or jsonb_typeof(p->'currencyDecimals') is distinct from 'number' or (p->>'currencyDecimals') !~ '^[0-6]$'
 or jsonb_typeof(p->'basis') is distinct from 'string' or (p->>'basis') not in ('net_items','order_total')
 or jsonb_typeof(p->'refundRule') is distinct from 'string' or (p->>'refundRule') not in ('proportional','full_on_any_refund')
 or jsonb_typeof(p->'rounding') is distinct from 'string' or (p->>'rounding') not in ('half_up','down')
 or jsonb_typeof(p->'basisMinor') is distinct from 'string' or (p->>'basisMinor') !~ '^(0|[1-9][0-9]{0,18})$'
 or jsonb_typeof(p->'refundedBasisMinor') is distinct from 'string' or (p->>'refundedBasisMinor') !~ '^(0|[1-9][0-9]{0,18})$'
 or jsonb_typeof(p->'grossMinor') is distinct from 'string' or (p->>'grossMinor') !~ '^(0|[1-9][0-9]{0,18})$'
 or jsonb_typeof(p->'reversalMinor') is distinct from 'string' or (p->>'reversalMinor') !~ '^(0|[1-9][0-9]{0,18})$'
 or jsonb_typeof(p->'netMinor') is distinct from 'string' or (p->>'netMinor') !~ '^(0|[1-9][0-9]{0,18})$'
 or jsonb_typeof(p->'qualification') is distinct from 'string' or (p->>'qualification') not in ('qualified','unqualified')
 or ((p->>'unqualifiedReason') is not null and jsonb_typeof(p->'unqualifiedReason') is distinct from 'string')
 or ((p->>'qualification')='qualified' and (p->>'unqualifiedReason') is not null)
 or ((p->>'qualification')='unqualified'
   and ((p->>'unqualifiedReason') is null or (p->>'unqualifiedReason') not in ('not_completed','not_paid')))
 or ((p->>'holdUntil') is not null and jsonb_typeof(p->'holdUntil') is distinct from 'string')
 or ((p->>'holdUntil') is not null and (p->>'holdUntil') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$')
 or (p ? 'supersedesEffectKey' and jsonb_typeof(p->'supersedesEffectKey') is distinct from 'string'
   and jsonb_typeof(p->'supersedesEffectKey') is distinct from 'null')
 or (jsonb_typeof(p->'supersedesEffectKey')='string'
   and ((p->>'supersedesEffectKey') !~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{2,199}$'
     or (p->>'supersedesEffectKey')=(p->>'effectKey')))
 then raise exception 'Invalid commission calculation' using errcode='22023'; end if;
 v_supersedes:=p->>'supersedesEffectKey';
 -- Serialize the whole (order, policy) chain before the effect key, so
 -- concurrent recordings and revisions of one order cannot interleave.
 perform pg_advisory_xact_lock(hashtextextended(
  'commissions.chain:'||(p->>'orderId')||':'||(p->>'policyVersion'),0));
 perform pg_advisory_xact_lock(hashtextextended('commissions.effect:'||(p->>'effectKey'),0));
 -- Exact replay (first record or revision) returns the stored row.
 select * into v_existing from commissions.calculations where effect_key=p->>'effectKey';
 if found then
  if v_existing.order_id=p->>'orderId' and v_existing.affiliate_id=(p->>'affiliateId')::uuid
   and v_existing.policy_version=(p->>'policyVersion')::integer and v_existing.currency=p->>'currency'
   and v_existing.currency_decimals=(p->>'currencyDecimals')::integer and v_existing.basis=p->>'basis'
   and v_existing.refund_rule=p->>'refundRule' and v_existing.rounding=p->>'rounding'
   and v_existing.basis_minor=p->>'basisMinor' and v_existing.refunded_basis_minor=p->>'refundedBasisMinor'
   and v_existing.gross_minor=p->>'grossMinor' and v_existing.reversal_minor=p->>'reversalMinor'
   and v_existing.net_minor=p->>'netMinor' and v_existing.qualification=p->>'qualification'
   and v_existing.unqualified_reason is not distinct from (p->>'unqualifiedReason')
   and v_existing.hold_until is not distinct from (p->>'holdUntil')::timestamptz
  then return v_existing.id; end if;
  raise exception 'Effect key already used for different content' using errcode='22023';
 end if;
 if v_supersedes is not null then
  select * into v_head from commissions.calculations
  where order_id=p->>'orderId' and policy_version=(p->>'policyVersion')::integer
   and superseded_by_id is null;
  if not found then
   raise exception 'No recorded calculation to supersede' using errcode='22023';
  end if;
  if v_head.effect_key<>v_supersedes then
   raise exception 'Supersede target is not the recorded head' using errcode='22023';
  end if;
  if v_head.affiliate_id<>(p->>'affiliateId')::uuid or v_head.currency<>p->>'currency'
   or v_head.currency_decimals<>(p->>'currencyDecimals')::integer or v_head.basis<>p->>'basis'
   or v_head.refund_rule<>p->>'refundRule' or v_head.rounding<>p->>'rounding' then
   raise exception 'Revision identity does not match the recorded head' using errcode='22023';
  end if;
  if v_head.qualification=(p->>'qualification')
   and v_head.unqualified_reason is not distinct from (p->>'unqualifiedReason')
   and v_head.basis_minor=p->>'basisMinor' and v_head.refunded_basis_minor=p->>'refundedBasisMinor'
   and v_head.gross_minor=p->>'grossMinor' and v_head.reversal_minor=p->>'reversalMinor'
   and v_head.net_minor=p->>'netMinor'
   and v_head.hold_until is not distinct from (p->>'holdUntil')::timestamptz then
   raise exception 'Revision changes nothing' using errcode='22023';
  end if;
  -- Posted money is never rewritten by a revision.
  if exists(select 1 from ledger.journals j
   where j.effect_key=v_head.effect_key
    or j.effect_key=v_head.effect_key||':release'
    or starts_with(j.effect_key, v_head.effect_key||':refund:')) then
   raise exception 'Recorded calculation already has posted journals'
    using errcode='55000';
  end if;
  v_id:=gen_random_uuid();
  update commissions.calculations set superseded_by_id=v_id where id=v_head.id;
  insert into commissions.calculations(id,effect_key,order_id,affiliate_id,policy_version,currency,
   currency_decimals,basis,refund_rule,rounding,basis_minor,refunded_basis_minor,gross_minor,
   reversal_minor,net_minor,qualification,unqualified_reason,hold_until,revision,supersedes_id)
  values(v_id,p->>'effectKey',p->>'orderId',(p->>'affiliateId')::uuid,
   (p->>'policyVersion')::integer,p->>'currency',(p->>'currencyDecimals')::integer,p->>'basis',
   p->>'refundRule',p->>'rounding',p->>'basisMinor',p->>'refundedBasisMinor',p->>'grossMinor',
   p->>'reversalMinor',p->>'netMinor',p->>'qualification',p->>'unqualifiedReason',
   (p->>'holdUntil')::timestamptz,v_head.revision+1,v_head.id);
  return v_id;
 end if;
 if exists(select 1 from commissions.calculations
   where order_id=p->>'orderId' and policy_version=(p->>'policyVersion')::integer) then
  raise exception 'Order already calculated under this policy version' using errcode='22023';
 end if;
 insert into commissions.calculations(effect_key,order_id,affiliate_id,policy_version,currency,currency_decimals,
  basis,refund_rule,rounding,basis_minor,refunded_basis_minor,gross_minor,reversal_minor,net_minor,
  qualification,unqualified_reason,hold_until)
 values(p->>'effectKey',p->>'orderId',(p->>'affiliateId')::uuid,(p->>'policyVersion')::integer,p->>'currency',
  (p->>'currencyDecimals')::integer,p->>'basis',p->>'refundRule',p->>'rounding',p->>'basisMinor',
  p->>'refundedBasisMinor',p->>'grossMinor',p->>'reversalMinor',p->>'netMinor',p->>'qualification',
  p->>'unqualifiedReason',(p->>'holdUntil')::timestamptz)
 returning id into v_id;
 return v_id;
end;
$$;

-- Totals count HEAD rows only: a superseded revision is history, and its
-- amounts must never double-count alongside its replacement.
create or replace function public.affiliate_commission_totals()
returns table(currency text, qualification text, status text, calculation_count bigint, net_minor text)
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 return query
 select c.currency, c.qualification, c.status, count(*)::bigint, sum(c.net_minor::numeric)::bigint::text
 from commissions.calculations c
 join public.affiliates a on a.id=c.affiliate_id
 where a.user_id=auth.uid() and c.superseded_by_id is null
 group by c.currency, c.qualification, c.status
 order by c.currency, c.qualification, c.status;
end;
$$;

-- Posting scan sees HEAD rows only; superseded revisions are invisible
-- to posting and release. Same signature and result shape as before.
create or replace function public.list_commission_calculations(
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
 where c.superseded_by_id is null
 and (p_qualification is null or c.qualification=p_qualification)
 and (p_due_before is null or (c.hold_until is not null and c.hold_until<=p_due_before))
 order by c.created_at asc, c.id asc
 limit p_limit;
end;
$$;

-- Recording scan: the recheck comparison target is the HEAD of the
-- highest-policy-version chain, and the scan now returns the head's full
-- recorded state so the worker can diff a fresh evaluation against it
-- and build a revision payload. Return shape changes, so the function
-- is dropped and recreated (grants re-applied below).
drop function public.list_orders_for_commission_recording(integer);
create function public.list_orders_for_commission_recording(
 p_limit integer default 50)
returns table(order_id text, order_at text, outcome text, affiliate_id uuid,
 snapshot jsonb, calc_effect_key text, calc_revision integer,
 calc_affiliate_id uuid, calc_basis text, calc_currency text,
 calc_currency_decimals integer, calc_refund_rule text, calc_rounding text,
 calc_basis_minor text, calc_refunded_basis_minor text, calc_gross_minor text,
 calc_reversal_minor text, calc_net_minor text, calc_qualification text,
 calc_unqualified_reason text, calc_hold_until text, calc_policy_version integer)
language plpgsql security definer set search_path='' as $$
begin
 if p_limit is null or p_limit not between 1 and 200 then
  raise exception 'Invalid recording scan' using errcode='22023';
 end if;
 return query
 select o.order_id::text,
  to_char(d.order_at at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  d.outcome, d.affiliate_id, o.snapshot,
  c.effect_key, c.revision, c.affiliate_id, c.basis, c.currency,
  c.currency_decimals, c.refund_rule, c.rounding, c.basis_minor,
  c.refunded_basis_minor, c.gross_minor, c.reversal_minor, c.net_minor,
  c.qualification, c.unqualified_reason, c.hold_until_text,
  c.policy_version
 from referral.order_decisions d
 join woo.orders o on o.order_id=d.order_id
 left join lateral (
  select cc.effect_key, cc.revision, cc.affiliate_id, cc.basis, cc.currency,
   cc.currency_decimals, cc.refund_rule, cc.rounding, cc.basis_minor,
   cc.refunded_basis_minor, cc.gross_minor, cc.reversal_minor, cc.net_minor,
   cc.qualification, cc.unqualified_reason, cc.policy_version, cc.created_at,
   to_char(cc.hold_until at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    as hold_until_text
  from commissions.calculations cc
  where cc.order_id=d.order_id::text and cc.superseded_by_id is null
  order by cc.policy_version desc limit 1
 ) c on true
 where c.basis is null or o.source_modified_at>c.created_at
 order by d.order_at asc, d.order_id asc
 limit p_limit;
end;
$$;

revoke all on function public.record_commission_calculation(jsonb),
 public.affiliate_commission_totals(),
 public.list_commission_calculations(text,timestamptz,integer),
 public.list_orders_for_commission_recording(integer)
 from public,anon,authenticated,service_role;
grant execute on function public.record_commission_calculation(jsonb) to service_role;
grant execute on function public.affiliate_commission_totals() to authenticated;
grant execute on function public.list_commission_calculations(text,timestamptz,integer) to service_role;
grant execute on function public.list_orders_for_commission_recording(integer) to service_role;
commit;
