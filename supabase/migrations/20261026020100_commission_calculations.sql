-- SOURCE-ONLY. Not installed anywhere. Depends on the identity migration
-- (public.affiliates), 20261016114552 (public.program_policies) and
-- 20261026020000 (policy rounding/qualification columns are informational
-- here; calculation rows snapshot the rounding actually used).
-- Private commission calculation snapshots: append-only records produced by
-- the Phase 4 engine. A row is a RECORD, not an earning: status is only
-- 'recorded' in this increment, nothing here posts journals, releases holds
-- or creates balances.
begin;
create schema commissions;
revoke all on schema commissions from public, anon, authenticated, service_role;

create table commissions.calculations (
 id uuid primary key default gen_random_uuid(),
 effect_key text not null unique check(effect_key ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{2,199}$'),
 order_id text not null check(order_id ~ '^[1-9][0-9]{0,15}$'),
 affiliate_id uuid not null references public.affiliates(id) on delete restrict,
 policy_version integer not null references public.program_policies(version) on delete restrict,
 currency text not null check(currency ~ '^[A-Z]{3}$'),
 currency_decimals integer not null check(currency_decimals between 0 and 6),
 basis text not null check(basis in ('net_items','order_total')),
 refund_rule text not null check(refund_rule in ('proportional','full_on_any_refund')),
 rounding text not null check(rounding in ('half_up','down')),
 basis_minor text not null check(basis_minor ~ '^(0|[1-9][0-9]{0,18})$'),
 refunded_basis_minor text not null check(refunded_basis_minor ~ '^(0|[1-9][0-9]{0,18})$'),
 gross_minor text not null check(gross_minor ~ '^(0|[1-9][0-9]{0,18})$'),
 reversal_minor text not null check(reversal_minor ~ '^(0|[1-9][0-9]{0,18})$'),
 net_minor text not null check(net_minor ~ '^(0|[1-9][0-9]{0,18})$'),
 qualification text not null check(qualification in ('qualified','unqualified')),
 unqualified_reason text check(unqualified_reason in ('not_completed','not_paid')),
 hold_until timestamptz,
 status text not null default 'recorded' check(status='recorded'),
 created_at timestamptz not null default now(),
 unique(order_id, policy_version),
 check((qualification='qualified' and unqualified_reason is null)
    or (qualification='unqualified' and unqualified_reason is not null))
);
create index commissions_calculations_affiliate on commissions.calculations(affiliate_id, created_at);

alter table commissions.calculations enable row level security;
revoke all on commissions.calculations from public, anon, authenticated, service_role;

create function commissions.reject_change() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 raise exception 'Commission calculations are append-only' using errcode='42501';
end;
$$;
create trigger calculations_immutable before update or delete or truncate on commissions.calculations
for each statement execute function commissions.reject_change();
revoke all on all functions in schema commissions from public, anon, authenticated, service_role;

-- Recording is a trusted server/worker operation only (service_role). The
-- payload mirrors the TS engine's CommissionCalculation; minor amounts stay
-- TEXT end-to-end so no floating point ever touches money.
create function public.record_commission_calculation(p jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_existing commissions.calculations%rowtype; v_id uuid;
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
 then raise exception 'Invalid commission calculation' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('commissions.effect:'||(p->>'effectKey'),0));
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

-- Affiliate-safe read: the ONLY application-facing surface over the private
-- schema. Security definer, but it aggregates exclusively the caller's own
-- affiliate row (resolved through public.affiliates.user_id = auth.uid());
-- no caller-supplied identity is accepted and no other affiliate's rows can
-- contribute. Amounts remain minor-unit TEXT.
create function public.affiliate_commission_totals()
returns table(currency text, qualification text, status text, calculation_count bigint, net_minor text)
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 return query
 select c.currency, c.qualification, c.status, count(*)::bigint, sum(c.net_minor::numeric)::bigint::text
 from commissions.calculations c
 join public.affiliates a on a.id=c.affiliate_id
 where a.user_id=auth.uid()
 group by c.currency, c.qualification, c.status
 order by c.currency, c.qualification, c.status;
end;
$$;
revoke all on function public.record_commission_calculation(jsonb),
 public.affiliate_commission_totals() from public,anon,authenticated,service_role;
grant execute on function public.record_commission_calculation(jsonb) to service_role;
grant execute on function public.affiliate_commission_totals() to authenticated;
commit;
