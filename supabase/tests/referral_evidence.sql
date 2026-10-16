-- Disposable/nonproduction only. Requires both referral migrations and Woo.
-- No live store reads, synthetic checkouts or persistent fixtures.
begin;
set local statement_timeout='20s';
insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-4000-8000-000000000091','evidence-partner@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000092','evidence-buyer@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000093','evidence-later@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('10000000-0000-4000-8000-000000000091','affiliate'),
 ('10000000-0000-4000-8000-000000000093','affiliate');
insert into public.affiliates(id,user_id,status) values
 ('20000000-0000-4000-8000-000000000091','10000000-0000-4000-8000-000000000091','approved'),
 ('20000000-0000-4000-8000-000000000093','10000000-0000-4000-8000-000000000093','approved');
insert into public.referral_campaigns(id,affiliate_id,request_id,code,name,destination_path) values
 ('30000000-0000-4000-8000-000000000091','20000000-0000-4000-8000-000000000091','40000000-0000-4000-8000-000000000091',repeat('a',32),'First','/'),
 ('30000000-0000-4000-8000-000000000093','20000000-0000-4000-8000-000000000093','40000000-0000-4000-8000-000000000093',repeat('b',32),'Later','/');
insert into woo.orders(order_id,snapshot,source_modified_at) values
 (9007199254740901,'{}',clock_timestamp()),(9007199254740902,'{}',clock_timestamp()),
 (9007199254740903,'{}',clock_timestamp()),(9007199254740904,'{}',clock_timestamp());
set local role service_role;
select public.capture_referral_touch('50000000-0000-4000-8000-000000000091',repeat('c',64),repeat('d',64),repeat('a',32),'first-click-7d-no-self-v1',true);
select public.capture_referral_touch('50000000-0000-4000-8000-000000000091',repeat('c',64),repeat('d',64),repeat('a',32),'first-click-7d-no-self-v1',true);
select public.capture_referral_touch('50000000-0000-4000-8000-000000000092',repeat('e',64),repeat('d',64),repeat('b',32),'first-click-7d-no-self-v1',true);
do $$ begin
 begin
  perform public.capture_referral_touch('50000000-0000-4000-8000-000000000091',repeat('f',64),repeat('d',64),repeat('a',32),'first-click-7d-no-self-v1',true);
  raise exception 'Conflicting nonce accepted';
 exception when serialization_failure then null; end;
 begin
  perform public.capture_referral_touch(gen_random_uuid(),repeat('f',64),repeat('d',64),repeat('a',32),'first-click-7d-no-self-v1',false);
  raise exception 'No-consent capture accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.associate_referral_order(gen_random_uuid(),repeat('f',64),repeat('d',64),'9007199254740900',clock_timestamp(),'10000000-0000-4000-8000-000000000092');
  raise exception 'Missing verified order accepted';
 exception when invalid_parameter_value then null; end;
end $$;
reset role;
do $$ declare t referral.touches%rowtype; begin
 if (select count(*) from referral.touches where visitor_hash=repeat('d',64))<>1 then raise exception 'First touch overwritten or duplicated'; end if;
 select * into t from referral.touches where visitor_hash=repeat('d',64);
 if t.affiliate_id<>'20000000-0000-4000-8000-000000000091' then raise exception 'Later partner stole credit'; end if;
 if t.expires_at-t.occurred_at<>interval '168 hours' then raise exception 'Wrong expiry'; end if;
end $$;
set local role service_role;
select public.associate_referral_order('60000000-0000-4000-8000-000000000091',repeat('1',64),repeat('d',64),'9007199254740901',clock_timestamp(),'10000000-0000-4000-8000-000000000092');
-- Exact receipt retry cannot create a second decision.
select public.associate_referral_order('60000000-0000-4000-8000-000000000091',repeat('1',64),repeat('d',64),'9007199254740901',clock_timestamp(),'10000000-0000-4000-8000-000000000092');
select public.associate_referral_order('60000000-0000-4000-8000-000000000092',repeat('2',64),repeat('d',64),'9007199254740902',clock_timestamp(),'10000000-0000-4000-8000-000000000091');
select public.associate_referral_order('60000000-0000-4000-8000-000000000093',repeat('3',64),repeat('9',64),'9007199254740903',clock_timestamp(),'10000000-0000-4000-8000-000000000092');
do $$ begin
 begin
  perform public.associate_referral_order(gen_random_uuid(),repeat('4',64),repeat('8',64),'9007199254740901',clock_timestamp(),'10000000-0000-4000-8000-000000000092');
  raise exception 'Order reassigned';
 exception when serialization_failure then null; end;
 begin
  perform 1 from referral.touches;
  raise exception 'Service direct read allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.affiliates set status='suspended' where id='20000000-0000-4000-8000-000000000091';
set local role service_role;
select public.associate_referral_order('60000000-0000-4000-8000-000000000094',repeat('4',64),repeat('d',64),'9007199254740904',clock_timestamp(),'10000000-0000-4000-8000-000000000092');
reset role;
do $$ begin
 if (select outcome from referral.order_decisions where order_id=9007199254740901) is distinct from 'attributed' then raise exception 'Attribution missing'; end if;
 if (select outcome from referral.order_decisions where order_id=9007199254740902) is distinct from 'self_referral' then raise exception 'Self referral credited'; end if;
 if (select outcome from referral.order_decisions where order_id=9007199254740903) is distinct from 'unattributed' then raise exception 'Unknown visitor credited'; end if;
 if (select outcome from referral.order_decisions where order_id=9007199254740904) is distinct from 'partner_unavailable' then raise exception 'Suspended partner credited'; end if;
 begin
  update referral.order_decisions set outcome='unattributed' where order_id=9007199254740901;
  raise exception 'Decision was mutable';
 exception when insufficient_privilege then null; end;
end $$;
set local role authenticated;
do $$ begin
 begin
  perform public.capture_referral_touch(gen_random_uuid(),repeat('f',64),repeat('d',64),repeat('a',32),'first-click-7d-no-self-v1',true);
  raise exception 'Browser role forged touch';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;