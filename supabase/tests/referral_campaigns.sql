-- Run ONLY on a disposable/nonproduction database after migration installation.
-- Never run these synthetic identity fixtures on production.
begin;
set local statement_timeout = '20s';
insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-4000-8000-000000000081','referral-one@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000082','referral-two@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000083','referral-pending@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('10000000-0000-4000-8000-000000000081','affiliate'),
 ('10000000-0000-4000-8000-000000000082','affiliate');
insert into public.affiliates(id,user_id,status) values
 ('20000000-0000-4000-8000-000000000081','10000000-0000-4000-8000-000000000081','approved'),
 ('20000000-0000-4000-8000-000000000082','10000000-0000-4000-8000-000000000082','approved');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000081","role":"authenticated","aal":"aal1"}',true);
do $$ declare code text; begin
 code := public.create_referral_campaign('30000000-0000-4000-8000-000000000081','Launch','/shop/');
 if code !~ '^[a-f0-9]{32}$' then raise exception 'Invalid generated code'; end if;
 if public.create_referral_campaign('30000000-0000-4000-8000-000000000081','Launch','/shop/') <> code then raise exception 'Retry changed code'; end if;
 if public.resolve_referral_campaign(code) is distinct from '/shop/' then raise exception 'Lookup failed'; end if;
 perform set_config('test.referral_code',code,true);
 perform public.set_referral_campaign_active(code,false);
 if public.resolve_referral_campaign(code) is not null then raise exception 'Paused lookup allowed'; end if;
 perform public.set_referral_campaign_active(code,true);
 begin
  perform public.create_referral_campaign('30000000-0000-4000-8000-000000000081','Different','/');
  raise exception 'Conflicting retry allowed';
 exception when serialization_failure then null; end;
 begin
  perform public.create_referral_campaign(gen_random_uuid(),'Unsafe','//evil.test');
  raise exception 'External redirect allowed';
 exception when invalid_parameter_value then null; end;
 begin
  update public.referral_campaigns set name='Direct write';
  raise exception 'Direct update allowed';
 exception when insufficient_privilege then null; end;
end $$;
do $$ begin
 for i in 2..50 loop
  perform public.create_referral_campaign(gen_random_uuid(),'Limit fixture ' || i,'/');
 end loop;
 if (select count(*) from public.referral_campaigns) <> 50 then raise exception 'Unexpected campaign count'; end if;
 begin
  perform public.create_referral_campaign(gen_random_uuid(),'Over limit','/');
  raise exception 'Account limit bypass';
 exception when program_limit_exceeded then null; end;
 -- Retry must still work at the cap; quota counts identities, not attempts.
 perform public.create_referral_campaign('30000000-0000-4000-8000-000000000081','Launch','/shop/');
end $$;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000082","role":"authenticated","aal":"aal1"}',true);
do $$ begin
 if exists(select 1 from public.referral_campaigns) then raise exception 'Cross-account read'; end if;
 begin
  perform public.create_referral_campaign('30000000-0000-4000-8000-000000000081','Launch','/shop/');
  raise exception 'Cross-account request replay';
 exception when serialization_failure then null; end;
 begin
  perform public.set_referral_campaign_active(repeat('a',32),false);
  raise exception 'Missing campaign update allowed';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000083","role":"authenticated","aal":"aal1"}',true);
do $$ begin
 begin
  perform public.create_referral_campaign(gen_random_uuid(),'Pending','/');
  raise exception 'Pending account created link';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Public lookup works without a session but table/account reads remain denied.
set local role anon;
do $$ begin
 if public.resolve_referral_campaign(current_setting('test.referral_code')) is distinct from '/shop/' then raise exception 'Anonymous lookup failed'; end if;
 begin
  perform 1 from public.referral_campaigns;
  raise exception 'Anonymous table read allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.affiliates set status='suspended' where id='20000000-0000-4000-8000-000000000081';
set local role anon;
do $$ begin
 if public.resolve_referral_campaign(current_setting('test.referral_code')) is not null then raise exception 'Suspended lookup allowed'; end if;
 begin
  perform public.create_referral_campaign(gen_random_uuid(),'Anonymous','/');
  raise exception 'Anonymous create allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ declare code text; begin
 select c.code into code from public.referral_campaigns c where c.request_id='30000000-0000-4000-8000-000000000081';
 if public.resolve_referral_campaign(code) is not null then raise exception 'Suspended partner resolved'; end if;
end $$;
rollback;