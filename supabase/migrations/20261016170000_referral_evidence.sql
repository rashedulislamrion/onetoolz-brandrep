begin;
create schema referral;
revoke all on schema referral from public, anon, authenticated, service_role;

create table referral.policies (
 version text primary key,
 window_seconds integer not null check(window_seconds=604800),
 precedence text not null check(precedence='first'),
 self_referral text not null check(self_referral='deny'),
 effective_at timestamptz not null default clock_timestamp()
);
insert into referral.policies(version,window_seconds,precedence,self_referral)
 values('first-click-7d-no-self-v1',604800,'first','deny');
create table referral.receipts (
 request_id uuid primary key,
 kind text not null check(kind in ('capture','order')),
 body_hash text not null check(body_hash ~ '^[a-f0-9]{64}$'),
 received_at timestamptz not null default clock_timestamp()
);
create table referral.touches (
 id uuid primary key default gen_random_uuid(),
 visitor_hash text not null check(visitor_hash ~ '^[a-f0-9]{64}$'),
 campaign_id uuid not null references public.referral_campaigns(id) on delete restrict,
 affiliate_id uuid not null references public.affiliates(id) on delete restrict,
 policy_version text not null references referral.policies(version) on delete restrict,
 consent boolean not null check(consent),
 occurred_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 check(expires_at=occurred_at+interval '168 hours')
);
create index referral_touches_visitor on referral.touches(visitor_hash,occurred_at,id);
create table referral.order_decisions (
 order_id bigint primary key references woo.orders(order_id) on delete restrict,
 request_id uuid not null unique references referral.receipts(request_id) on delete restrict,
 visitor_hash text not null check(visitor_hash ~ '^[a-f0-9]{64}$'),
 buyer_user_id uuid not null references auth.users(id) on delete restrict,
 order_at timestamptz not null,
 policy_version text not null references referral.policies(version) on delete restrict,
 touch_id uuid references referral.touches(id) on delete restrict,
 affiliate_id uuid references public.affiliates(id) on delete restrict,
 outcome text not null check(outcome in ('attributed','unattributed','self_referral','partner_unavailable')),
 created_at timestamptz not null default clock_timestamp(),
 check((outcome='attributed' and touch_id is not null and affiliate_id is not null)
   or (outcome<>'attributed' and affiliate_id is null))
);
alter table referral.policies enable row level security;
alter table referral.receipts enable row level security;
alter table referral.touches enable row level security;
alter table referral.order_decisions enable row level security;
revoke all on all tables in schema referral from public, anon, authenticated, service_role;
create trigger referral_policies_immutable before update or delete on referral.policies
 for each row execute function public.prevent_application_event_change();
create trigger referral_receipts_immutable before update or delete on referral.receipts
 for each row execute function public.prevent_application_event_change();
create trigger referral_touches_immutable before update or delete on referral.touches
 for each row execute function public.prevent_application_event_change();
create trigger referral_decisions_immutable before update or delete on referral.order_decisions
 for each row execute function public.prevent_application_event_change();

-- Only the authenticated server bridge can execute these RPCs. The browser
-- cannot submit timestamps, buyer identities or consent directly to storage.
create function public.capture_referral_touch(
 p_request_id uuid,p_body_hash text,p_visitor_hash text,p_code text,p_policy_version text,p_consent boolean
) returns void language plpgsql security definer set search_path='' as $$
declare r referral.receipts%rowtype; c public.referral_campaigns%rowtype;
 t referral.touches%rowtype; captured_at timestamptz;
begin
 if p_request_id is null or p_body_hash is null or p_body_hash !~ '^[a-f0-9]{64}$'
 or p_visitor_hash is null or p_visitor_hash !~ '^[a-f0-9]{64}$'
 or p_code is null or p_code !~ '^[a-f0-9]{32}$'
 or p_policy_version is distinct from 'first-click-7d-no-self-v1' or p_consent is distinct from true then
  raise exception 'Invalid referral capture' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('referral.receipt:'||p_request_id::text,0));
 select * into r from referral.receipts where request_id=p_request_id;
 if found then
  if r.kind='capture' and r.body_hash=p_body_hash then return; end if;
  raise exception 'Conflicting referral request' using errcode='40001';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('referral.visitor:'||p_visitor_hash,0));
 captured_at:=clock_timestamp();
 select c0.* into c from public.referral_campaigns c0
 join public.affiliates a on a.id=c0.affiliate_id
 where c0.code=p_code and c0.active and a.status='approved'
 and exists(select 1 from public.user_roles where user_id=a.user_id and role='affiliate');
 if not found then raise exception 'Campaign unavailable' using errcode='22023'; end if;
 select * into t from referral.touches where visitor_hash=p_visitor_hash and expires_at>captured_at
  order by occurred_at,id limit 1;
 if not found then
  insert into referral.touches(visitor_hash,campaign_id,affiliate_id,policy_version,consent,occurred_at,expires_at)
   values(p_visitor_hash,c.id,c.affiliate_id,p_policy_version,true,captured_at,captured_at+interval '168 hours');
 end if;
 -- Later clicks never overwrite or extend the winning first-click window.
 insert into referral.receipts(request_id,kind,body_hash) values(p_request_id,'capture',p_body_hash);
end;
$$;

create function public.associate_referral_order(
 p_request_id uuid,p_body_hash text,p_visitor_hash text,p_order_id text,p_order_at timestamptz,p_buyer_user_id uuid
) returns void language plpgsql security definer set search_path='' as $$
declare r referral.receipts%rowtype; d referral.order_decisions%rowtype; t referral.touches%rowtype;
 partner public.affiliates%rowtype; decision text; winner uuid;
begin
 if p_request_id is null or p_body_hash is null or p_body_hash !~ '^[a-f0-9]{64}$'
 or p_visitor_hash is null or p_visitor_hash !~ '^[a-f0-9]{64}$'
 or p_order_id is null or p_order_id !~ '^[1-9][0-9]{0,15}$' or p_order_id::numeric>9007199254740991
 or p_order_at is null or not isfinite(p_order_at) or p_order_at>clock_timestamp()
 or p_buyer_user_id is null then raise exception 'Invalid referral order' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('referral.receipt:'||p_request_id::text,0));
 select * into r from referral.receipts where request_id=p_request_id;
 if found then
  if r.kind='order' and r.body_hash=p_body_hash then return; end if;
  raise exception 'Conflicting referral request' using errcode='40001';
 end if;
 -- Require independent Woo ingestion first; missing orders retry, never become
 -- fabricated conversions. Bridge supplies creation time, not payment evidence.
 perform 1 from woo.orders where order_id=p_order_id::bigint for update;
 if not found then raise exception 'Verified order required' using errcode='22023'; end if;
 if not exists(select 1 from auth.users where id=p_buyer_user_id and email_confirmed_at is not null) then
  raise exception 'Verified buyer required' using errcode='42501';
 end if;
 if p_order_at<(select effective_at from referral.policies where version='first-click-7d-no-self-v1') then
  raise exception 'Order predates attribution policy' using errcode='22023';
 end if;
 select * into d from referral.order_decisions where order_id=p_order_id::bigint;
 if found then
  if d.visitor_hash=p_visitor_hash and d.buyer_user_id=p_buyer_user_id and d.order_at=p_order_at then
   insert into referral.receipts(request_id,kind,body_hash) values(p_request_id,'order',p_body_hash);
   return;
  end if;
  raise exception 'Order already resolved with different evidence' using errcode='40001';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('referral.visitor:'||p_visitor_hash,0));
 select * into t from referral.touches where visitor_hash=p_visitor_hash and occurred_at<=p_order_at
  and expires_at>p_order_at and policy_version='first-click-7d-no-self-v1' order by occurred_at,id limit 1;
 decision:='unattributed';
 if found then
  select * into partner from public.affiliates where id=t.affiliate_id for share;
  if partner.user_id=p_buyer_user_id then decision:='self_referral';
  elsif partner.status<>'approved' or not exists(select 1 from public.user_roles where user_id=partner.user_id and role='affiliate')
   then decision:='partner_unavailable';
  else decision:='attributed'; winner:=t.affiliate_id;
  end if;
 end if;
 insert into referral.receipts(request_id,kind,body_hash) values(p_request_id,'order',p_body_hash);
 insert into referral.order_decisions(order_id,request_id,visitor_hash,buyer_user_id,order_at,policy_version,touch_id,affiliate_id,outcome)
 values(p_order_id::bigint,p_request_id,p_visitor_hash,p_buyer_user_id,p_order_at,'first-click-7d-no-self-v1',t.id,winner,decision);
 -- Attribution is not a qualified sale, settlement proof or a commission post.
end;
$$;
revoke all on function public.capture_referral_touch(uuid,text,text,text,text,boolean),
 public.associate_referral_order(uuid,text,text,text,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.capture_referral_touch(uuid,text,text,text,text,boolean),
 public.associate_referral_order(uuid,text,text,text,timestamptz,uuid) to service_role;
commit;