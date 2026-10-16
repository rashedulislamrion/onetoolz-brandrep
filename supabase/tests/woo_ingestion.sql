-- Nonproduction only. After migration, or concatenate inside a rollback rehearsal.
begin;
create function pg_temp.woo_snapshot(p_time text default '2026-10-14T10:00:00Z') returns jsonb language sql as $$
 select jsonb_build_object('id','42','status','completed','currency','USD','total','10.00',
 'paymentMethod','fixture','paidAt','2026-10-14T09:00:00Z','modifiedAt',p_time,
 'refunds','[]'::jsonb,'commissionEnabled',false)
$$;
do $$ declare j jsonb; old_lease uuid; new_lease uuid; n integer; begin
 if exists(select 1 from woo.jobs) or exists(select 1 from woo.events) then raise exception 'Requires empty isolated intake'; end if;
 perform public.ingest_woo_notification('1','fixture-1','order.updated','42',repeat('a',64));
 perform public.ingest_woo_notification('1','fixture-1','order.updated','42',repeat('a',64));
 if (select count(*) from woo.events)<>1 or (select generation from woo.jobs where order_id=42)<>1 then raise exception 'Duplicate changed state'; end if;
 begin
   perform public.ingest_woo_notification('1','fixture-1','order.updated','42',repeat('b',64));
   raise exception 'Conflict accepted';
 exception when invalid_parameter_value then null; end;
 j:=public.claim_woo_refresh(); old_lease:=(j->>'lease')::uuid;
 if j->>'orderId'<>'42' or public.claim_woo_refresh() is not null then raise exception 'Claim isolation failed'; end if;
 perform public.ingest_woo_notification('1','fixture-2','order.updated','42',repeat('b',64));
 perform public.finish_woo_refresh('42',old_lease,pg_temp.woo_snapshot(),true);
 if (select state from woo.jobs where order_id=42)<>'pending' then raise exception 'Incoming generation lost'; end if;
 j:=public.claim_woo_refresh(); new_lease:=(j->>'lease')::uuid;
 begin
   perform public.finish_woo_refresh('42',old_lease,pg_temp.woo_snapshot(),true);
   raise exception 'Stale token accepted';
 exception when invalid_parameter_value then null; end;
 perform public.finish_woo_refresh('42',new_lease,pg_temp.woo_snapshot('2026-10-13T10:00:00Z'),true);
 if (select last_error from woo.jobs where order_id=42)<>'STALE_SOURCE_SNAPSHOT' then raise exception 'Stale source not retried'; end if;
 if (select source_modified_at from woo.orders where order_id=42)<>'2026-10-14T10:00:00Z'::timestamptz then raise exception 'Snapshot regressed'; end if;
 update woo.jobs set due_at=now()-interval '1 second' where order_id=42;
 j:=public.claim_woo_refresh(); old_lease:=(j->>'lease')::uuid;
 update woo.jobs set lease_until=clock_timestamp()-interval '1 second' where order_id=42;
 begin
   perform public.finish_woo_refresh('42',old_lease,pg_temp.woo_snapshot(),true);
   raise exception 'Expired token accepted';
 exception when invalid_parameter_value then null; end;
 j:=public.claim_woo_refresh(); new_lease:=(j->>'lease')::uuid;
 if new_lease=old_lease or not exists(select 1 from woo.attempts where outcome='lease_expired') then raise exception 'Lease not recovered'; end if;
 perform public.finish_woo_refresh('42',new_lease,null,false);
 for n in 1..8 loop
   update woo.jobs set due_at=now()-interval '1 second' where order_id=42;
   j:=public.claim_woo_refresh();
   exit when j is null;
   perform public.finish_woo_refresh('42',(j->>'lease')::uuid,null,false);
 end loop;
 if (select state from woo.jobs where order_id=42)<>'failed' or (select attempts from woo.jobs where order_id=42)<>8 then raise exception 'Retry cap failed'; end if;
 update woo.jobs set updated_at=now()-interval '16 minutes' where order_id=42;
 if public.requeue_woo_orders()<>1 then raise exception 'Reconciliation failed'; end if;
 if (select attempts from woo.jobs where order_id=42)<>0 then raise exception 'Retry reset failed'; end if;
 begin
   update woo.events set topic='order.deleted'; raise exception 'History mutable';
 exception when insufficient_privilege then null; end;
 if exists(select 1 from woo.orders where commission_enabled) then raise exception 'Finance activated'; end if;
end $$;
set local role anon;
do $$ begin
 begin perform public.claim_woo_refresh(); raise exception 'Anonymous access'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
do $$ begin
 begin perform public.requeue_woo_orders(); raise exception 'User access'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role service_role;
select public.ingest_woo_notification('1','fixture-service','order.updated','43',repeat('c',64));
do $$ begin
 begin perform 1 from woo.events; raise exception 'Direct service table access'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'woo ingestion suite passed' as verification;