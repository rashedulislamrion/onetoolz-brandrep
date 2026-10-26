-- Nonproduction/disposable database ONLY; requires the identity, Woo,
-- referral campaign + evidence, publication migrations, 20261026020000,
-- 20261026020100 and 20261026040000_commission_recording.sql. Never run
-- on production.
begin;
set local statement_timeout='20s';
insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-4000-8000-000000000071','rec-admin@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000091','rec-affiliate@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000092','rec-buyer@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('10000000-0000-4000-8000-000000000071','admin'),
 ('10000000-0000-4000-8000-000000000091','affiliate');
insert into public.affiliates(id,user_id,status) values
 ('20000000-0000-4000-8000-000000000091','10000000-0000-4000-8000-000000000091','approved');
-- Publish one order_total policy (hold days and minimum payout are read
-- back from the published row itself by the recording worker).
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000071","role":"authenticated","aal":"aal2"}',true);
do $$ declare revision integer; version integer; begin
 select coalesce(max(revision),0) into revision from public.program_settings_drafts;
 select coalesce(max(version),0) into version from public.program_policies;
 revision:=public.save_program_settings_draft(gen_random_uuid(),revision,1000,'USD','25',30,'manual','Synthetic recording draft');
 version:=public.publish_program_policy(gen_random_uuid(),revision,version,2,'order_total','proportional','half_up','paid_completed','Synthetic recording policy');
 perform set_config('test.policy_version',version::text,true);
end $$;
reset role;
-- Policy history surface: complete row, canonical effective_at, hold days
-- and rules carried on the published row (never the drafts).
do $$ declare v integer:=current_setting('test.policy_version')::integer; n integer; begin
 select count(*) into n from public.list_program_policies_for_recording();
 -- This suite may run after other suites in the same database; require at
 -- least the row we just published and validate that row exactly.
 if n<1 then raise exception 'Policy history empty'; end if;
 if not exists(select 1 from public.list_program_policies_for_recording()
  where version=v and commission_bps=1000 and currency='USD' and currency_decimals=2
  and minimum_payout='25' and hold_days=30 and basis='order_total'
  and refund_rule='proportional' and scope='all_products_one_time'
  and rounding='half_up' and qualification='paid_completed'
  and effective_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$')
 then raise exception 'Published policy row mismatch'; end if;
end $$;
-- Store fixtures: campaign, Woo orders in the STORED snapshot shape, and
-- genuine bridge decisions (attributed / unattributed / self_referral).
insert into public.referral_campaigns(id,affiliate_id,request_id,code,name,destination_path) values
 ('30000000-0000-4000-8000-000000000091','20000000-0000-4000-8000-000000000091','40000000-0000-4000-8000-000000000091',repeat('a',32),'First','/');
insert into woo.orders(order_id,snapshot,source_modified_at) values
 (7001,'{"id":"7001","status":"completed","currency":"USD","total":"100.00","paymentMethod":"piprapay","paidAt":"2026-01-10T10:05:00Z","modifiedAt":"2026-01-10T10:05:00Z","refunds":[{"id":"1","total":"-25.00"}],"commissionEnabled":false}',clock_timestamp()),
 (7002,'{"id":"7002","status":"completed","currency":"USD","total":"50.00","paymentMethod":"piprapay","paidAt":"2026-01-10T11:05:00Z","modifiedAt":"2026-01-10T11:05:00Z","refunds":[],"commissionEnabled":false}',clock_timestamp()),
 (7003,'{"id":"7003","status":"completed","currency":"USD","total":"60.00","paymentMethod":"piprapay","paidAt":"2026-01-10T12:05:00Z","modifiedAt":"2026-01-10T12:05:00Z","refunds":[],"commissionEnabled":false}',clock_timestamp()),
 -- Recorded below; snapshot modified time FORCED future so the recheck
 -- pre-filter surfaces it deterministically inside this transaction.
 (7004,'{"id":"7004","status":"completed","currency":"USD","total":"80.00","paymentMethod":"piprapay","paidAt":"2026-01-10T13:05:00Z","modifiedAt":"2026-01-10T13:05:00Z","refunds":[{"id":"1","total":"-10.00"}],"commissionEnabled":false}','2999-01-01T00:00:00Z'),
 -- Recorded below; snapshot modified time forced PAST so it must not be
 -- resurfaced as a recheck candidate.
 (7005,'{"id":"7005","status":"completed","currency":"USD","total":"80.00","paymentMethod":"piprapay","paidAt":"2026-01-10T14:05:00Z","modifiedAt":"2026-01-10T14:05:00Z","refunds":[],"commissionEnabled":false}','2000-01-01T00:00:00Z');
set local role service_role;
select public.capture_referral_touch('50000000-0000-4000-8000-000000000091',repeat('c',64),repeat('d',64),repeat('a',32),'first-click-7d-no-self-v1',true);
select public.associate_referral_order('60000000-0000-4000-8000-000000000091',repeat('1',64),repeat('d',64),'7001',clock_timestamp(),'10000000-0000-4000-8000-000000000092');
select public.associate_referral_order('60000000-0000-4000-8000-000000000092',repeat('2',64),repeat('9',64),'7002',clock_timestamp(),'10000000-0000-4000-8000-000000000092');
select public.associate_referral_order('60000000-0000-4000-8000-000000000093',repeat('3',64),repeat('d',64),'7003',clock_timestamp(),'10000000-0000-4000-8000-000000000091');
select public.associate_referral_order('60000000-0000-4000-8000-000000000094',repeat('4',64),repeat('d',64),'7004',clock_timestamp(),'10000000-0000-4000-8000-000000000092');
select public.associate_referral_order('60000000-0000-4000-8000-000000000095',repeat('5',64),repeat('d',64),'7005',clock_timestamp(),'10000000-0000-4000-8000-000000000092');
-- Pre-record calculations for 7004 and 7005 so the scan treats them as
-- recheck candidates / excluded rows respectively.
do $$ declare v integer:=current_setting('test.policy_version')::integer; begin
 perform public.record_commission_calculation(jsonb_build_object('effectKey','commission:order:7004:policy:'||v,'orderId','7004',
  'affiliateId','20000000-0000-4000-8000-000000000091','policyVersion',v,'currency','USD','currencyDecimals',2,
  'basis','order_total','refundRule','proportional','rounding','half_up','basisMinor','8000','refundedBasisMinor','0',
  'grossMinor','800','reversalMinor','0','netMinor','800','qualification','qualified','unqualifiedReason',null,
  'holdUntil','2026-02-09T10:00:00.000Z'));
 perform public.record_commission_calculation(jsonb_build_object('effectKey','commission:order:7005:policy:'||v,'orderId','7005',
  'affiliateId','20000000-0000-4000-8000-000000000091','policyVersion',v,'currency','USD','currencyDecimals',2,
  'basis','order_total','refundRule','proportional','rounding','half_up','basisMinor','8000','refundedBasisMinor','0',
  'grossMinor','800','reversalMinor','0','netMinor','800','qualification','qualified','unqualifiedReason',null,
  'holdUntil','2026-02-09T10:00:00.000Z'));
end $$;
reset role;
-- Scan surface: unrecorded decided orders plus the drifted recorded one;
-- the unchanged recorded order (7005) stays out.
do $$ begin
 if (select count(*) from public.list_orders_for_commission_recording(50)
  where order_id in ('7001','7002','7003','7004','7005'))<>4
 then raise exception 'Recording scan membership mismatch'; end if;
 if exists(select 1 from public.list_orders_for_commission_recording(50) where order_id='7005')
 then raise exception 'Unchanged recorded order resurfaced'; end if;
 if not exists(select 1 from public.list_orders_for_commission_recording(50)
  where order_id='7001' and outcome='attributed'
  and affiliate_id='20000000-0000-4000-8000-000000000091' and calc_basis is null
  and order_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
  and (snapshot->>'total')='100.00')
 then raise exception 'Attributed scan row mismatch'; end if;
 if not exists(select 1 from public.list_orders_for_commission_recording(50)
  where order_id='7002' and outcome='unattributed' and affiliate_id is null)
 then raise exception 'Unattributed scan row mismatch'; end if;
 if not exists(select 1 from public.list_orders_for_commission_recording(50)
  where order_id='7003' and outcome='self_referral' and affiliate_id is null)
 then raise exception 'Self-referral scan row mismatch'; end if;
 if not exists(select 1 from public.list_orders_for_commission_recording(50)
  where order_id='7004' and calc_basis='order_total' and calc_currency_decimals=2
  and calc_refunded_basis_minor='0' and calc_qualification='qualified'
  and calc_policy_version=current_setting('test.policy_version')::integer)
 then raise exception 'Recheck scan row mismatch'; end if;
 if (select count(*) from public.list_orders_for_commission_recording(2))<>2
 then raise exception 'Recording scan limit mismatch'; end if;
 begin
  perform public.list_orders_for_commission_recording(0);
  raise exception 'Zero limit accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.list_orders_for_commission_recording(201);
  raise exception 'Oversize limit accepted';
 exception when invalid_parameter_value then null; end;
end $$;
-- Denials: the recording surface is service_role-only, and service_role
-- still cannot read the private decision table directly.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000091","role":"authenticated","aal":"aal1"}',true);
do $$ begin
 begin
  perform 1 from public.list_orders_for_commission_recording(50);
  raise exception 'Authenticated recording scan accepted';
 exception when insufficient_privilege then null; end;
 begin
  perform 1 from public.list_program_policies_for_recording();
  raise exception 'Authenticated policy history accepted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role service_role;
do $$ begin
 begin
  perform 1 from referral.order_decisions;
  raise exception 'Service direct decision read allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform 1 from woo.orders;
  raise exception 'Service direct order read allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
