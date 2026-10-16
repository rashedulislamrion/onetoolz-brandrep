begin;
create table public.program_policies (
 version integer primary key check(version>0),
 request_id uuid not null unique,
 draft_revision integer not null unique references public.program_settings_drafts(revision),
 commission_bps integer not null check(commission_bps between 0 and 10000),
 currency text not null check(currency ~ '^[A-Z]{3}$'),
 currency_decimals integer not null check(currency_decimals between 0 and 6),
 minimum_payout text not null check(minimum_payout ~ '^(0|[1-9][0-9]{0,8})(\.[0-9]{1,6})?$'),
 hold_days integer not null check(hold_days between 0 and 365),
 payout_cadence text not null check(payout_cadence in ('manual','weekly','monthly')),
 basis text not null check(basis in ('net_items','order_total')),
 refund_rule text not null check(refund_rule in ('proportional','full_on_any_refund')),
 scope text not null default 'all_products_one_time' check(scope='all_products_one_time'),
 reason text not null check(char_length(btrim(reason)) between 10 and 1000),
 published_by uuid not null references auth.users(id),
 effective_at timestamptz not null default clock_timestamp(),
 check(position('.' in minimum_payout)=0 or length(split_part(minimum_payout,'.',2))<=currency_decimals)
);
alter table public.program_policies enable row level security;
revoke all on public.program_policies from public,anon,authenticated,service_role;
grant select on public.program_policies to authenticated;
create policy admin_published_policy_read on public.program_policies for select to authenticated using (
 (select auth.jwt()->>'aal')='aal2' and exists(select 1 from public.user_roles where user_id=(select auth.uid()) and role='admin')
);
create trigger program_policies_immutable before update or delete on public.program_policies
 for each row execute function public.prevent_application_event_change();

create function public.publish_program_policy(
 p_request_id uuid,p_draft_revision integer,p_expected_version integer,p_currency_decimals integer,
 p_basis text,p_refund_rule text,p_reason text
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
 or p_reason is null or char_length(btrim(p_reason)) not between 10 and 1000 then
  raise exception 'Invalid publication' using errcode='22023'; end if;
 -- Serialize publication and draft saves in a consistent lock order.
 lock table public.program_settings_drafts in share mode;
 lock table public.program_policies in exclusive mode;
 select * into existing from public.program_policies where request_id=p_request_id;
 if found then
  if existing.published_by=auth.uid() and existing.version=p_expected_version+1 and existing.draft_revision=p_draft_revision
   and existing.currency_decimals=p_currency_decimals and existing.basis=p_basis
   and existing.refund_rule=p_refund_rule and existing.reason=btrim(p_reason) then return existing.version; end if;
  raise exception 'Conflicting publication' using errcode='40001';
 end if;
 select coalesce(max(version),0) into latest from public.program_policies;
 if latest<>p_expected_version or p_draft_revision<>(select max(revision) from public.program_settings_drafts)
 or exists(select 1 from public.program_policies where draft_revision=p_draft_revision) then
  raise exception 'Stale publication' using errcode='40001'; end if;
 select * into d from public.program_settings_drafts where revision=p_draft_revision;
 if not found then raise exception 'Draft required' using errcode='22023'; end if;
 insert into public.program_policies(version,request_id,draft_revision,commission_bps,currency,currency_decimals,
  minimum_payout,hold_days,payout_cadence,basis,refund_rule,reason,published_by)
 values(latest+1,p_request_id,d.revision,d.commission_bps,d.currency,p_currency_decimals,d.minimum_payout,
  d.hold_days,d.payout_cadence,p_basis,p_refund_rule,btrim(p_reason),auth.uid());
 return latest+1;
end;
$$;
revoke all on function public.publish_program_policy(uuid,integer,integer,integer,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.publish_program_policy(uuid,integer,integer,integer,text,text,text) to authenticated;
commit;