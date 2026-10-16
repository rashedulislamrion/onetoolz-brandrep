-- Nonproduction/disposable database ONLY; requires publication migration.
begin;
set local statement_timeout='20s';
insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-4000-8000-000000000071','publication-admin@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000072','publication-member@example.invalid',now());
insert into public.user_roles(user_id,role) values('10000000-0000-4000-8000-000000000071','admin');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000071","role":"authenticated","aal":"aal2"}',true);
do $$ declare revision integer; version integer; result integer; begin
 select coalesce(max(d.revision),0) into revision from public.program_settings_drafts d;
 select coalesce(max(p.version),0) into version from public.program_policies p;
 revision:=public.save_program_settings_draft(gen_random_uuid(),revision,1250,'USD','25.5',30,'manual','Synthetic publication draft');
 result:=public.publish_program_policy('20000000-0000-4000-8000-000000000071',revision,version,2,'net_items','proportional','Synthetic publication approval');
 if result<>version+1 then raise exception 'Wrong policy version'; end if;
 if public.publish_program_policy('20000000-0000-4000-8000-000000000071',revision,version,2,'net_items','proportional','Synthetic publication approval')<>result then raise exception 'Retry mismatch'; end if;
 begin
  perform public.publish_program_policy(gen_random_uuid(),revision,version,2,'net_items','proportional','Synthetic stale publication');
  raise exception 'Stale writer accepted';
 exception when serialization_failure then null; end;
 begin
  update public.program_policies set commission_bps=10000;
  raise exception 'Direct write accepted';
 exception when insufficient_privilege then null; end;
 revision:=public.save_program_settings_draft(gen_random_uuid(),revision,1500,'USD','25.5',30,'manual','Synthetic precision draft');
 begin
  perform public.publish_program_policy(gen_random_uuid(),revision,result,0,'order_total','full_on_any_refund','Synthetic invalid precision');
  raise exception 'Invalid precision accepted';
 exception when check_violation then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000071","role":"authenticated","aal":"aal1"}',true);
do $$ begin
 begin
  perform public.publish_program_policy(gen_random_uuid(),1,0,2,'net_items','proportional','Synthetic denied publication');
  raise exception 'AAL1 publication accepted';
 exception when insufficient_privilege then null; end;
 if exists(select 1 from public.program_policies) then raise exception 'AAL1 read accepted'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000072","role":"authenticated","aal":"aal2"}',true);
do $$ begin
 begin
  perform public.publish_program_policy(gen_random_uuid(),1,0,2,'net_items','proportional','Synthetic denied publication');
  raise exception 'Nonadmin publication accepted';
 exception when insufficient_privilege then null; end;
 if exists(select 1 from public.program_policies) then raise exception 'Nonadmin read accepted'; end if;
end $$;
reset role;
-- Even an owner-context UPDATE must hit the append-only trigger.
do $$ begin
 begin
  update public.program_policies set commission_bps=0;
  raise exception 'Immutable policy changed';
 exception when insufficient_privilege then null; end;
end $$;
rollback;