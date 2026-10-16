-- Installed on nonproduction 2026-10-16 as 20261016080727. Requires woo_ingestion; no ledger writes.
begin;
create table woo.discovery (
 singleton boolean primary key default true check(singleton),
 page integer not null default 1 check(page between 1 and 1000000),
 scan_before timestamptz not null default clock_timestamp(),
 due_at timestamptz not null default clock_timestamp(),
 lease uuid, lease_until timestamptz,
 completed_at timestamptz,
 check((lease is null) = (lease_until is null))
);
alter table woo.discovery enable row level security;
revoke all on woo.discovery from public,anon,authenticated,service_role;
insert into woo.discovery(singleton) values(true);

create function public.claim_woo_discovery() returns jsonb
language plpgsql security definer set search_path='' as $$
declare d woo.discovery%rowtype; token uuid:=gen_random_uuid();
begin
 select * into d from woo.discovery where singleton and due_at<=clock_timestamp()
 and (lease is null or lease_until<=clock_timestamp()) for update skip locked;
 if not found then return null; end if;
 -- An abandoned scan restarts from page 1 to recover shrinking offset pagination.
 -- Already queued IDs are deduplicated by the jobs primary key.
 if d.lease is not null then d.page:=1; d.scan_before:=clock_timestamp(); end if;
 update woo.discovery set lease=token,lease_until=clock_timestamp()+interval '2 minutes',
 page=d.page,scan_before=d.scan_before where singleton;
 return jsonb_build_object('lease',token,'page',d.page,'before',to_char(d.scan_before at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'));
end;
$$;

create function public.finish_woo_discovery(p_lease uuid,p_page integer,p_ids text[],p_complete boolean)
returns integer language plpgsql security definer set search_path='' as $$
declare d woo.discovery%rowtype; n integer; id text; previous bigint:=0;
begin
 select * into d from woo.discovery where singleton for update;
 if not found or d.lease is null or d.lease is distinct from p_lease or d.page is distinct from p_page
 or d.lease_until<=clock_timestamp() then raise exception 'Stale discovery lease' using errcode='22023'; end if;
 if p_ids is null or cardinality(p_ids)>50 or p_complete is null or (not p_complete and cardinality(p_ids)<>50)
 then raise exception 'Invalid discovery page' using errcode='22023'; end if;
 foreach id in array p_ids loop
   if id is null or id !~ '^[1-9][0-9]{0,15}$' or id::numeric>9007199254740991 or id::bigint<=previous
   then raise exception 'Invalid discovery ID' using errcode='22023'; end if;
   previous:=id::bigint;
 end loop;
 -- Missing only: never reset an existing worker lease, attempts, or generation.
 insert into woo.jobs(order_id) select value::bigint from unnest(p_ids) value on conflict(order_id) do nothing;
 get diagnostics n=row_count;
 update woo.discovery set page=case when p_complete then 1 else page+1 end,
 scan_before=case when p_complete then clock_timestamp() else scan_before end,
 due_at=case when p_complete then clock_timestamp()+interval '1 hour' else clock_timestamp() end,
 completed_at=case when p_complete then clock_timestamp() else completed_at end,
 lease=null,lease_until=null where singleton;
 return n;
end;
$$;
revoke all on function public.claim_woo_discovery(),public.finish_woo_discovery(uuid,integer,text[],boolean) from public,anon,authenticated,service_role;
grant execute on function public.claim_woo_discovery(),public.finish_woo_discovery(uuid,integer,text[],boolean) to service_role;
commit;