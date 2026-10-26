-- Nonproduction/disposable database ONLY; requires the publication migrations,
-- 20261026020000_policy_rounding_qualification.sql and
-- 20261026020100_commission_calculations.sql. Never run on production.
begin;
set local statement_timeout='20s';
insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-4000-8000-000000000071','calc-admin@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000091','calc-affiliate-a@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000092','calc-affiliate-b@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('10000000-0000-4000-8000-000000000071','admin'),
 ('10000000-0000-4000-8000-000000000091','affiliate'),
 ('10000000-0000-4000-8000-000000000092','affiliate');
insert into public.affiliates(id,user_id,status) values
 ('20000000-0000-4000-8000-000000000091','10000000-0000-4000-8000-000000000091','approved'),
 ('20000000-0000-4000-8000-000000000092','10000000-0000-4000-8000-000000000092','approved');
-- Publish one policy with the new rounding/qualification signature.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000071","role":"authenticated","aal":"aal2"}',true);
do $$ declare revision integer; version integer; begin
 select coalesce(max(revision),0) into revision from public.program_settings_drafts;
 select coalesce(max(version),0) into version from public.program_policies;
 revision:=public.save_program_settings_draft(gen_random_uuid(),revision,1000,'USD','25',30,'manual','Synthetic calculation draft');
 version:=public.publish_program_policy(gen_random_uuid(),revision,version,2,'net_items','proportional','half_up','paid_completed','Synthetic calculation policy');
 perform set_config('test.policy_version',version::text,true);
end $$;
reset role;
-- Recording is service_role only and idempotent on effect_key.
set local role service_role;
do $$ declare v integer:=current_setting('test.policy_version')::integer; payload jsonb; first_id uuid; retry_id uuid; begin
 payload:=jsonb_build_object('effectKey','commission:order:5001:policy:'||v,'orderId','5001',
  'affiliateId','20000000-0000-4000-8000-000000000091','policyVersion',v,'currency','USD','currencyDecimals',2,
  'basis','net_items','refundRule','proportional','rounding','half_up','basisMinor','1000','refundedBasisMinor','200',
  'grossMinor','100','reversalMinor','20','netMinor','80','qualification','qualified','unqualifiedReason',null,
  'holdUntil','2026-11-15T10:00:00.000Z');
 first_id:=public.record_commission_calculation(payload);
 retry_id:=public.record_commission_calculation(payload);
 if first_id is null or retry_id<>first_id then raise exception 'Idempotent record retry mismatch'; end if;
 begin
  perform public.record_commission_calculation(payload || jsonb_build_object('netMinor','81'));
  raise exception 'Conflicting effect key accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.record_commission_calculation(payload || jsonb_build_object('effectKey','commission:order:5001:policy:'||v||':dup'));
  raise exception 'Duplicate order/policy accepted under a new effect key';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.record_commission_calculation(payload || jsonb_build_object('effectKey','commission:order:5003:policy:'||v,'netMinor','1.5'));
  raise exception 'Fractional minor amount accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.record_commission_calculation(payload || jsonb_build_object('effectKey','commission:order:5004:policy:'||v,'orderId','5004','qualification','qualified','unqualifiedReason','not_paid'));
  raise exception 'Qualified row with an unqualified reason accepted';
 exception when invalid_parameter_value then null; end;
 perform public.record_commission_calculation(jsonb_build_object('effectKey','commission:order:5002:policy:'||v,'orderId','5002',
  'affiliateId','20000000-0000-4000-8000-000000000092','policyVersion',v,'currency','USD','currencyDecimals',2,
  'basis','net_items','refundRule','proportional','rounding','half_up','basisMinor','500','refundedBasisMinor','0',
  'grossMinor','50','reversalMinor','0','netMinor','50','qualification','unqualified','unqualifiedReason','not_paid',
  'holdUntil','2026-11-15T10:00:00.000Z'));
end $$;
reset role;
-- Authenticated callers cannot record or read the private table directly.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000091","role":"authenticated","aal":"aal1"}',true);
do $$ begin
 begin
  perform public.record_commission_calculation('{}'::jsonb);
  raise exception 'Authenticated record accepted';
 exception when insufficient_privilege then null; end;
 begin
  perform 1 from commissions.calculations;
  raise exception 'Direct private-table read accepted';
 exception when insufficient_privilege then null; end;
 -- Totals expose only the caller's own affiliate rows.
 if (select count(*) from public.affiliate_commission_totals())<>1 then raise exception 'Caller totals should have exactly one group'; end if;
 if (select net_minor from public.affiliate_commission_totals())<>'80' then raise exception 'Caller totals net mismatch'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000092","role":"authenticated","aal":"aal1"}',true);
do $$ begin
 if (select count(*) from public.affiliate_commission_totals())<>1 then raise exception 'Second affiliate totals should have exactly one group'; end if;
 if (select net_minor from public.affiliate_commission_totals())<>'50' then raise exception 'Second affiliate totals leaked or mismatched'; end if;
 if (select qualification from public.affiliate_commission_totals())<>'unqualified' then raise exception 'Second affiliate qualification mismatch'; end if;
end $$;
reset role;
-- Append-only: even an owner-context UPDATE/DELETE hits the reject trigger.
do $$ begin
 begin
  update commissions.calculations set net_minor='0';
  raise exception 'Calculation updated';
 exception when insufficient_privilege then null; end;
 begin
  delete from commissions.calculations;
  raise exception 'Calculation deleted';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
