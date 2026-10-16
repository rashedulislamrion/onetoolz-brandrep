-- Run as postgres on nonproduction after the settings migration, in ONE request.
-- For a pre-install rehearsal, insert migration DDL immediately after BEGIN.
begin;
set local statement_timeout = '20s';
insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-4000-8000-000000000061','settings-admin@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000062','settings-member@example.invalid',now());
insert into public.user_roles(user_id,role) values ('10000000-0000-4000-8000-000000000061','admin');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000061","role":"authenticated","aal":"aal2"}',true);
do $$ declare base integer; first_revision integer; begin
 select coalesce(max(revision),0) into base from public.program_settings_drafts;
 first_revision := public.save_program_settings_draft('20000000-0000-4000-8000-000000000061',base,1250,'USD','25.5',30,'monthly','Synthetic settings test');
 if first_revision <> base+1 then raise exception 'Wrong first revision'; end if;
 if public.save_program_settings_draft('20000000-0000-4000-8000-000000000061',base,1250,'USD','25.5',30,'monthly','Synthetic settings test') <> first_revision then raise exception 'Retry not idempotent'; end if;
 begin
  perform public.save_program_settings_draft('20000000-0000-4000-8000-000000000061',base,1251,'USD','25.5',30,'monthly','Synthetic settings test');
  raise exception 'Conflicting request accepted';
 exception when serialization_failure then null; end;
 begin
  perform public.save_program_settings_draft('20000000-0000-4000-8000-000000000062',base,1250,'USD','25.5',30,'monthly','Synthetic settings test');
  raise exception 'Stale editor accepted';
 exception when serialization_failure then null; end;
 begin
  perform public.save_program_settings_draft(gen_random_uuid(),first_revision,10001,'USD','25.5',30,'monthly','Synthetic settings test');
  raise exception 'Invalid rate accepted';
 exception when check_violation then null; end;
 begin
  perform public.save_program_settings_draft(gen_random_uuid(),first_revision,1000,'USD','1e5',30,'monthly','Synthetic settings test');
  raise exception 'Invalid decimal accepted';
 exception when check_violation then null; end;
 begin
  perform public.save_program_settings_draft(gen_random_uuid(),first_revision,1000,'USD','25',366,'monthly','Synthetic settings test');
  raise exception 'Invalid hold accepted';
 exception when check_violation then null; end;
 begin
  perform public.save_program_settings_draft(gen_random_uuid(),first_revision,1000,'usd','25',30,'monthly','Synthetic settings test');
  raise exception 'Invalid currency accepted';
 exception when check_violation then null; end;
 begin
  perform public.save_program_settings_draft(gen_random_uuid(),first_revision,1000,'USD','25',30,'automatic','Synthetic settings test');
  raise exception 'Invalid cadence accepted';
 exception when check_violation then null; end;
 begin
  perform public.save_program_settings_draft(gen_random_uuid(),first_revision,1000,'USD','25',30,'monthly','short');
  raise exception 'Invalid reason accepted';
 exception when check_violation then null; end;
 begin
  perform public.save_program_settings_draft(null,first_revision,1000,'USD','25',30,'monthly','Synthetic settings test');
  raise exception 'Null request accepted';
 exception when not_null_violation then null; end;
 if public.save_program_settings_draft('20000000-0000-4000-8000-000000000062',first_revision,1500,'USD','50',45,'weekly','Second synthetic revision') <> first_revision+1 then raise exception 'Second revision missing'; end if;
 if not exists(select 1 from public.program_settings_drafts where revision=first_revision and commission_bps=1250 and created_by=auth.uid() and created_at is not null) then raise exception 'History changed'; end if;
 begin update public.program_settings_drafts set commission_bps=1; raise exception 'Direct update allowed'; exception when insufficient_privilege then null; end;
 begin delete from public.program_settings_drafts; raise exception 'Direct delete allowed'; exception when insufficient_privilege then null; end;
 begin insert into public.program_settings_drafts select * from public.program_settings_drafts; raise exception 'Direct insert allowed'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000061","role":"authenticated","aal":"aal1"}',true);
do $$ begin
 if exists(select 1 from public.program_settings_drafts) then raise exception 'AAL1 read leak'; end if;
 begin perform public.save_program_settings_draft(gen_random_uuid(),0,1000,'USD','25',30,'manual','Unauthorized attempt'); raise exception 'AAL1 write allowed'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000062","role":"authenticated","aal":"aal2"}',true);
do $$ begin
 if exists(select 1 from public.program_settings_drafts) then raise exception 'Nonadmin read leak'; end if;
 begin perform public.save_program_settings_draft(gen_random_uuid(),0,1000,'USD','25',30,'manual','Unauthorized attempt'); raise exception 'Nonadmin write allowed'; exception when insufficient_privilege then null; end;
end $$;
set local role anon;
do $$ begin
 begin perform 1 from public.program_settings_drafts; raise exception 'Anonymous read allowed'; exception when insufficient_privilege then null; end;
 begin perform public.save_program_settings_draft(gen_random_uuid(),0,1000,'USD','25',30,'manual','Unauthorized attempt'); raise exception 'Anonymous write allowed'; exception when insufficient_privilege then null; end;
end $$;
set local role service_role;
do $$ begin
 begin perform 1 from public.program_settings_drafts; raise exception 'Service read allowed'; exception when insufficient_privilege then null; end;
 begin perform public.save_program_settings_draft(gen_random_uuid(),0,1000,'USD','25',30,'manual','Unauthorized attempt'); raise exception 'Service write allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'program_settings passed' as suite,
 (select count(*) from auth.users where id in ('10000000-0000-4000-8000-000000000061','10000000-0000-4000-8000-000000000062')) as remaining_fixture_users;