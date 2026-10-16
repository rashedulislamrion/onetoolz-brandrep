-- Nonproduction only, after ingestion + discovery migrations. ONE request, rollback only.
begin;
set local statement_timeout='20s';
do $$ declare c jsonb; next_claim jsonb; ids text[]; n integer; begin
 select array_agg(i::text order by i) into ids from generate_series(8000000000000001::bigint,8000000000000050::bigint) i;
 if exists(select 1 from woo.jobs where order_id between 8000000000000001 and 8000000000000051) then raise exception 'Fixture collision'; end if;
 update woo.discovery set page=1,lease=null,lease_until=null,due_at=clock_timestamp();
 c:=public.claim_woo_discovery();
 if c is null or public.claim_woo_discovery() is not null then raise exception 'Claim exclusivity'; end if;
 begin perform public.finish_woo_discovery(gen_random_uuid(),1,ids,false); raise exception 'Wrong lease accepted'; exception when invalid_parameter_value then null; end;
 n:=public.finish_woo_discovery((c->>'lease')::uuid,1,ids,false);
 if n<>50 or (select page from woo.discovery)<>2 then raise exception 'Page checkpoint failed'; end if;
 next_claim:=public.claim_woo_discovery();
 if next_claim->>'before' is distinct from c->>'before' then raise exception 'Cutoff changed'; end if;
 begin perform public.finish_woo_discovery((c->>'lease')::uuid,1,ids,false); raise exception 'Replayed lease accepted'; exception when invalid_parameter_value then null; end;
 update woo.jobs set generation=7 where order_id=8000000000000001;
 n:=public.finish_woo_discovery((next_claim->>'lease')::uuid,2,array['8000000000000001','8000000000000051'],true);
 if n<>1 or (select generation from woo.jobs where order_id=8000000000000001)<>7 then raise exception 'Duplicate job changed'; end if;
 if public.claim_woo_discovery() is not null then raise exception 'Cooldown ignored'; end if;
 update woo.discovery set due_at=clock_timestamp();
 c:=public.claim_woo_discovery();
 update woo.discovery set lease_until=clock_timestamp()-interval '1 second',page=2;
 next_claim:=public.claim_woo_discovery();
 if (next_claim->>'page')::integer<>1 or next_claim->>'lease'=c->>'lease' then raise exception 'Recovery failed'; end if;
 begin perform public.finish_woo_discovery((c->>'lease')::uuid,1,array[]::text[],true); raise exception 'Expired lease accepted'; exception when invalid_parameter_value then null; end;
end $$;
set local role authenticated;
do $$ begin
 begin perform public.claim_woo_discovery(); raise exception 'Authenticated claim allowed'; exception when insufficient_privilege then null; end;
 begin perform 1 from woo.discovery; raise exception 'Direct read allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'woo_discovery rollback suite passed' as result;