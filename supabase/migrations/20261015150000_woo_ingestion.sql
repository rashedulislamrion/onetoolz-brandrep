-- PREPARED, NOT APPLIED. Single approved store; no financial or ledger access.
begin;
create schema woo;
revoke all on schema woo from public,anon,authenticated,service_role;
create table woo.events (
 id uuid primary key default gen_random_uuid(),
 webhook_id text not null, delivery_id text not null,
 topic text not null check(topic in ('order.created','order.updated','order.deleted','order.restored')),
 order_id bigint not null check(order_id>0), body_hash text not null check(body_hash ~ '^[0-9a-f]{64}$'),
 received_at timestamptz not null default now(), unique(webhook_id,delivery_id)
);
create table woo.jobs (
 order_id bigint primary key check(order_id>0), generation bigint not null default 1,
 state text not null default 'pending' check(state in ('pending','working','done','failed')),
 attempts integer not null default 0, due_at timestamptz not null default now(),
 lease uuid, lease_until timestamptz, claimed_generation bigint,
  last_error text, updated_at timestamptz not null default now(),
  check(attempts between 0 and 8),
  check(generation>0),
  check((state='working' and lease is not null and lease_until is not null and claimed_generation is not null)
    or (state<>'working' and lease is null and lease_until is null))
);
create table woo.orders (
 order_id bigint primary key check(order_id>0), snapshot jsonb not null,
 source_modified_at timestamptz not null, checked_at timestamptz not null default now(),
 commission_enabled boolean not null default false check(not commission_enabled)
);
create table woo.attempts (
 id bigint generated always as identity primary key,
 order_id bigint not null references woo.jobs(order_id) on delete restrict,
 lease uuid not null, outcome text not null check(outcome in ('success','failure','lease_expired')),
 error_code text, created_at timestamptz not null default now()
);
create index woo_jobs_ready on woo.jobs(state,due_at);
create index woo_attempts_order on woo.attempts(order_id,created_at);
alter table woo.events enable row level security;
alter table woo.jobs enable row level security;
alter table woo.orders enable row level security;
alter table woo.attempts enable row level security;
revoke all on all tables in schema woo from public,anon,authenticated,service_role;
revoke all on all sequences in schema woo from public,anon,authenticated,service_role;
create trigger woo_events_immutable before update or delete on woo.events
for each row execute function public.prevent_application_event_change();
create trigger woo_attempts_immutable before update or delete on woo.attempts
for each row execute function public.prevent_application_event_change();

create function public.ingest_woo_notification(p_webhook_id text,p_delivery_id text,p_topic text,p_order_id text,p_body_hash text)
returns void language plpgsql security definer set search_path='' as $$
declare v_event woo.events%rowtype;
begin
 if p_webhook_id is null or p_webhook_id !~ '^[1-9][0-9]{0,18}$'
 or p_delivery_id is null or p_delivery_id !~ '^[A-Za-z0-9_-]{1,100}$'
 or p_topic is null or p_topic not in ('order.created','order.updated','order.deleted','order.restored')
 or p_order_id is null or p_order_id !~ '^[1-9][0-9]{0,15}$' or p_order_id::numeric>9007199254740991
 or p_body_hash is null or p_body_hash !~ '^[0-9a-f]{64}$' then
 raise exception 'Invalid notification' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('woo.delivery:'||p_webhook_id||':'||p_delivery_id,0));
 select * into v_event from woo.events where webhook_id=p_webhook_id and delivery_id=p_delivery_id;
 if found then
   if v_event.body_hash<>p_body_hash or v_event.order_id<>p_order_id::bigint or v_event.topic<>p_topic then
     raise exception 'Conflicting delivery' using errcode='22023';
   end if;
   return;
 end if;
 insert into woo.events(webhook_id,delivery_id,topic,order_id,body_hash)
 values(p_webhook_id,p_delivery_id,p_topic,p_order_id::bigint,p_body_hash);
 insert into woo.jobs(order_id) values(p_order_id::bigint) on conflict(order_id) do update
 set generation=woo.jobs.generation+1,
 state=case when woo.jobs.state='working' then 'working' else 'pending' end,
 attempts=case when woo.jobs.state='working' then woo.jobs.attempts else 0 end,
 due_at=now(),updated_at=now();
end;
$$;

create function public.claim_woo_refresh() returns jsonb
language plpgsql security definer set search_path='' as $$
declare j woo.jobs%rowtype; token uuid:=gen_random_uuid();
begin
 select * into j from woo.jobs where
 (state='pending' and due_at<=clock_timestamp()) or (state='working' and lease_until<=clock_timestamp())
 order by due_at,order_id for update skip locked limit 1;
 if not found then return null; end if;
 if j.state='working' then
   insert into woo.attempts(order_id,lease,outcome,error_code) values(j.order_id,j.lease,'lease_expired','WORKER_LEASE_EXPIRED');
 end if;
 if j.attempts>=8 then
   update woo.jobs set state='failed',last_error='RETRY_LIMIT',lease=null,lease_until=null,updated_at=now() where order_id=j.order_id;
   return null;
 end if;
 update woo.jobs set state='working',attempts=attempts+1,lease=token,lease_until=clock_timestamp()+interval '2 minutes',
 claimed_generation=generation,updated_at=now() where order_id=j.order_id;
 return jsonb_build_object('id',j.order_id::text,'orderId',j.order_id::text,'lease',token::text);
end;
$$;

create function public.finish_woo_refresh(p_order_id text,p_lease uuid,p_snapshot jsonb,p_success boolean)
returns void language plpgsql security definer set search_path='' as $$
declare j woo.jobs%rowtype; modified timestamptz; v_success boolean:=p_success; v_error text:='ORDER_REFRESH_FAILED';
begin
 select * into j from woo.jobs where order_id=p_order_id::bigint for update;
 if not found or j.state<>'working' or j.lease is distinct from p_lease or j.lease_until<=clock_timestamp() then
 raise exception 'Stale worker lease' using errcode='22023'; end if;
 if p_success is null then raise exception 'Missing result' using errcode='22023'; end if;
 if p_success then
   if p_snapshot is null or jsonb_typeof(p_snapshot) is distinct from 'object'
   or (p_snapshot->>'id') is distinct from p_order_id
   or (p_snapshot->'commissionEnabled') is distinct from 'false'::jsonb
   or jsonb_typeof(p_snapshot->'refunds') is distinct from 'array'
   or jsonb_typeof(p_snapshot->'status') is distinct from 'string'
   or jsonb_typeof(p_snapshot->'modifiedAt') is distinct from 'string' then
     raise exception 'Invalid snapshot' using errcode='22023';
   end if;
   modified:=(p_snapshot->>'modifiedAt')::timestamptz;
    if not isfinite(modified) or modified>clock_timestamp()+interval '5 minutes' then raise exception 'Future snapshot' using errcode='22023'; end if;
   insert into woo.orders(order_id,snapshot,source_modified_at) values(j.order_id,p_snapshot,modified)
   on conflict(order_id) do update set snapshot=excluded.snapshot,source_modified_at=excluded.source_modified_at,checked_at=now()
   where woo.orders.source_modified_at<=excluded.source_modified_at;
    if not found then v_success:=false; v_error:='STALE_SOURCE_SNAPSHOT'; end if;
 end if;
 insert into woo.attempts(order_id,lease,outcome,error_code)
 values(j.order_id,p_lease,case when v_success then 'success' else 'failure' end,case when v_success then null else v_error end);
 update woo.jobs set
 state=case when generation<>claimed_generation then 'pending' when v_success then 'done' when attempts>=8 then 'failed' else 'pending' end,
 attempts=case when generation<>claimed_generation then 0 else attempts end,
 due_at=case when generation<>claimed_generation then now() else now()+make_interval(secs=>least(3600,30*power(2,attempts)::integer)) end,
 last_error=case when v_success then null else v_error end,
 lease=null,lease_until=null,updated_at=now() where order_id=j.order_id;
end;
$$;

-- Reconciliation of KNOWN orders only. Discovery of missing orders needs paginated Woo scans.
create function public.requeue_woo_orders() returns integer
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 with candidates as (select order_id from woo.jobs where state in ('done','failed')
   and updated_at<now()-interval '15 minutes' order by updated_at for update skip locked limit 100)
 update woo.jobs set state='pending',attempts=0,generation=generation+1,due_at=now(),updated_at=now()
 where order_id in (select order_id from candidates);
 get diagnostics n=row_count; return n;
end;
$$;
revoke all on function public.ingest_woo_notification(text,text,text,text,text),public.claim_woo_refresh(),
 public.finish_woo_refresh(text,uuid,jsonb,boolean),public.requeue_woo_orders() from public,anon,authenticated,service_role;
grant execute on function public.ingest_woo_notification(text,text,text,text,text),public.claim_woo_refresh(),
 public.finish_woo_refresh(text,uuid,jsonb,boolean),public.requeue_woo_orders() to service_role;
commit;