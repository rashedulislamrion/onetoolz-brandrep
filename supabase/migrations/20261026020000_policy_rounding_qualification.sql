-- SOURCE-ONLY. Not installed anywhere. Depends on
-- 20261016114552_program_policy_publication.sql (and its draft prerequisite).
-- Adds the admin-versioned rounding and qualification rules that
-- 20261016114552 deliberately left unstated, so the commission engine never
-- has to guess them. Existing published rows keep NULL for both columns:
-- they predate the rules and must not be silently treated as if an
-- administrator had approved rounding or qualification for them.
begin;
alter table public.program_policies
 add column rounding text check(rounding in ('half_up','down')),
 add column qualification text check(qualification='paid_completed');

-- Replace the publication RPC. The old signature is dropped so no caller can
-- publish a new policy without stating rounding and qualification. Security
-- posture is unchanged: administrator role + AAL2, serialized publication,
-- latest-draft/stale-version checks and identical-request idempotency,
-- extended to compare the two new fields.
drop function public.publish_program_policy(uuid,integer,integer,integer,text,text,text);

create function public.publish_program_policy(
 p_request_id uuid,p_draft_revision integer,p_expected_version integer,p_currency_decimals integer,
 p_basis text,p_refund_rule text,p_rounding text,p_qualification text,p_reason text
) returns integer language plpgsql security definer set search_path='' as $$
declare d public.program_settings_drafts%rowtype; existing public.program_policies%rowtype; latest integer;
begin
 if auth.uid() is null or (auth.jwt()->>'aal') is distinct from 'aal2' or not exists(
  select 1 from public.user_roles where user_id=auth.uid() and role='admin'
 ) then raise exception 'Administrator MFA required' using errcode='42501'; end if;
 if p_request_id is null or p_draft_revision is null or p_draft_revision<1 or p_expected_version is null or p_expected_version<0
 or p_currency_decimals is null or p_currency_decimals not between 0 and 6
 or p_basis is null or p_basis not in ('net_items','order_total')
 or p_refund_rule is null or p_refund_rule not in ('proportional','full_on_any_refund')
 or p_rounding is null or p_rounding not in ('half_up','down')
 or p_qualification is null or p_qualification<>'paid_completed'
 or p_reason is null or char_length(btrim(p_reason)) not between 10 and 1000 then
  raise exception 'Invalid publication' using errcode='22023'; end if;
 -- Serialize publication and draft saves in a consistent lock order.
 lock table public.program_settings_drafts in share mode;
 lock table public.program_policies in exclusive mode;
 select * into existing from public.program_policies where request_id=p_request_id;
 if found then
  if existing.published_by=auth.uid() and existing.version=p_expected_version+1 and existing.draft_revision=p_draft_revision
   and existing.currency_decimals=p_currency_decimals and existing.basis=p_basis
   and existing.refund_rule=p_refund_rule and existing.rounding=p_rounding
   and existing.qualification=p_qualification and existing.reason=btrim(p_reason) then return existing.version; end if;
  raise exception 'Conflicting publication' using errcode='40001';
 end if;
 select coalesce(max(version),0) into latest from public.program_policies;
 if latest<>p_expected_version or p_draft_revision<>(select max(revision) from public.program_settings_drafts)
 or exists(select 1 from public.program_policies where draft_revision=p_draft_revision) then
  raise exception 'Stale publication' using errcode='40001'; end if;
 select * into d from public.program_settings_drafts where revision=p_draft_revision;
 if not found then raise exception 'Draft required' using errcode='22023'; end if;
 -- The existing table constraint still enforces minimum_payout precision
 -- against currency_decimals on this insert.
 insert into public.program_policies(version,request_id,draft_revision,commission_bps,currency,currency_decimals,
  minimum_payout,hold_days,payout_cadence,basis,refund_rule,rounding,qualification,reason,published_by)
 values(latest+1,p_request_id,d.revision,d.commission_bps,d.currency,p_currency_decimals,d.minimum_payout,
  d.hold_days,d.payout_cadence,p_basis,p_refund_rule,p_rounding,p_qualification,btrim(p_reason),auth.uid());
 return latest+1;
end;
$$;
revoke all on function public.publish_program_policy(uuid,integer,integer,integer,text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.publish_program_policy(uuid,integer,integer,integer,text,text,text,text,text) to authenticated;
commit;
