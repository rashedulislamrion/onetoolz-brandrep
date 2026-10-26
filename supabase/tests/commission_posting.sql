-- Nonproduction/disposable database ONLY; requires the ledger foundation,
-- publication migrations, 20261026020000, 20261026020100 and
-- 20261026030000_commission_posting.sql. Never run on production.
begin;
set local statement_timeout='20s';
insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-4000-8000-000000000071','post-admin@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000091','post-affiliate-a@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000092','post-affiliate-b@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('10000000-0000-4000-8000-000000000071','admin'),
 ('10000000-0000-4000-8000-000000000091','affiliate'),
 ('10000000-0000-4000-8000-000000000092','affiliate');
insert into public.affiliates(id,user_id,status) values
 ('20000000-0000-4000-8000-000000000091','10000000-0000-4000-8000-000000000091','approved'),
 ('20000000-0000-4000-8000-000000000092','10000000-0000-4000-8000-000000000092','approved');
-- Publish one policy and record one qualified calculation (net 80, hold due
-- in the past relative to the suite's fixed due scan below).
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000071","role":"authenticated","aal":"aal2"}',true);
do $$ declare revision integer; version integer; begin
 select coalesce(max(revision),0) into revision from public.program_settings_drafts;
 select coalesce(max(version),0) into version from public.program_policies;
 revision:=public.save_program_settings_draft(gen_random_uuid(),revision,1000,'USD','25',30,'manual','Synthetic posting draft');
 version:=public.publish_program_policy(gen_random_uuid(),revision,version,2,'net_items','proportional','half_up','paid_completed','Synthetic posting policy');
 perform set_config('test.policy_version',version::text,true);
end $$;
reset role;
set local role service_role;
do $$ declare v integer:=current_setting('test.policy_version')::integer; begin
 perform public.record_commission_calculation(jsonb_build_object('effectKey','commission:order:6001:policy:'||v,'orderId','6001',
  'affiliateId','20000000-0000-4000-8000-000000000091','policyVersion',v,'currency','USD','currencyDecimals',2,
  'basis','net_items','refundRule','proportional','rounding','half_up','basisMinor','1000','refundedBasisMinor','200',
  'grossMinor','100','reversalMinor','20','netMinor','80','qualification','qualified','unqualifiedReason',null,
  'holdUntil','2026-01-15T10:00:00.000Z'));
 perform public.record_commission_calculation(jsonb_build_object('effectKey','commission:order:6002:policy:'||v,'orderId','6002',
  'affiliateId','20000000-0000-4000-8000-000000000092','policyVersion',v,'currency','USD','currencyDecimals',2,
  'basis','net_items','refundRule','proportional','rounding','half_up','basisMinor','500','refundedBasisMinor','0',
  'grossMinor','50','reversalMinor','0','netMinor','50','qualification','unqualified','unqualifiedReason','not_paid',
  'holdUntil','2027-01-15T10:00:00.000Z'));
end $$;
-- Scan surface: qualification filter and due filter behave.
do $$ begin
 if (select count(*) from public.list_commission_calculations())<>2 then raise exception 'Unfiltered scan mismatch'; end if;
 if (select count(*) from public.list_commission_calculations('qualified'))<>1 then raise exception 'Qualified scan mismatch'; end if;
 if (select count(*) from public.list_commission_calculations('qualified','2026-02-01T00:00:00Z'))<>1 then raise exception 'Due scan mismatch'; end if;
 if (select count(*) from public.list_commission_calculations('qualified','2026-01-01T00:00:00Z'))<>0 then raise exception 'Not-due scan mismatch'; end if;
 begin
  perform public.list_commission_calculations('bogus');
  raise exception 'Invalid qualification accepted';
 exception when invalid_parameter_value then null; end;
end $$;
-- Account provisioning: idempotent, expense shared per currency, held and
-- payable distinct per affiliate.
do $$ declare a jsonb; b jsonb; a2 jsonb; begin
 a:=public.get_or_create_commission_accounts('20000000-0000-4000-8000-000000000091','USD',2);
 b:=public.get_or_create_commission_accounts('20000000-0000-4000-8000-000000000092','USD',2);
 a2:=public.get_or_create_commission_accounts('20000000-0000-4000-8000-000000000091','USD',2);
 if a is distinct from a2 then raise exception 'Account provisioning not idempotent'; end if;
 if (a->>'expenseAccountId') is distinct from (b->>'expenseAccountId') then raise exception 'Expense account not shared per currency'; end if;
 if (a->>'heldAccountId') is not distinct from (b->>'heldAccountId') then raise exception 'Held accounts not per-affiliate'; end if;
 if (a->>'heldAccountId') is not distinct from (a->>'payableAccountId') then raise exception 'Held and payable accounts conflated'; end if;
 perform set_config('test.accounts_a',a::text,true);
 begin
  perform public.get_or_create_commission_accounts('20000000-0000-4000-8000-000000000099','USD',2);
  raise exception 'Unknown affiliate provisioned';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.get_or_create_commission_accounts('20000000-0000-4000-8000-000000000091','USD',3);
  raise exception 'Currency exponent mismatch accepted';
 exception when invalid_parameter_value then null; end;
end $$;
-- Posting surface: namespace guarded, earn journal idempotent, state probe
-- tracks earn / refund-prefix / release journals exactly.
do $$ declare a jsonb:=current_setting('test.accounts_a')::jsonb; v integer:=current_setting('test.policy_version')::integer;
 key text; earn jsonb; first_id uuid; retry_id uuid; state jsonb; begin
 key:='commission:order:6001:policy:'||v;
 begin
  perform public.post_commission_journal(jsonb_build_object('effectKey','other:namespace','currency','USD','exponent',2,
   'reason','Namespace probe','lines','[]'::jsonb));
  raise exception 'Non-commission namespace accepted';
 exception when invalid_parameter_value then null; end;
 earn:=jsonb_build_object('effectKey',key,'currency','USD','exponent',2,
  'reason','Commission earned for order 6001 under policy '||v,
  'lines',jsonb_build_array(
   jsonb_build_object('accountId',a->>'expenseAccountId','currency','USD','exponent',2,'debitMinor','80','creditMinor','0'),
   jsonb_build_object('accountId',a->>'heldAccountId','currency','USD','exponent',2,'debitMinor','0','creditMinor','80')));
 first_id:=public.post_commission_journal(earn);
 retry_id:=public.post_commission_journal(earn);
 if first_id is null or retry_id<>first_id then raise exception 'Earn posting retry mismatch'; end if;
 state:=public.commission_posting_state(key);
 if (state->>'earnJournalId')::uuid<>first_id or (state->>'earnMinor')<>'80'
  or (state->>'reversalPostedMinor')<>'0' or (state->>'releaseJournalId') is not null
  then raise exception 'Posting state after earn mismatch'; end if;
 -- Delta refund reversal under the :refund: prefix.
 perform public.post_commission_journal(jsonb_build_object('effectKey',key||':refund:200','currency','USD','exponent',2,
  'reason','Commission reversal for order 6001 under policy '||v,
  'lines',jsonb_build_array(
   jsonb_build_object('accountId',a->>'heldAccountId','currency','USD','exponent',2,'debitMinor','20','creditMinor','0'),
   jsonb_build_object('accountId',a->>'expenseAccountId','currency','USD','exponent',2,'debitMinor','0','creditMinor','20'))));
 state:=public.commission_posting_state(key);
 if (state->>'reversalPostedMinor')<>'20' then raise exception 'Posted reversal total mismatch'; end if;
 -- Release journal under :release moves held -> payable for the remainder.
 perform public.post_commission_journal(jsonb_build_object('effectKey',key||':release','currency','USD','exponent',2,
  'reason','Commission released for order 6001 under policy '||v,
  'lines',jsonb_build_array(
   jsonb_build_object('accountId',a->>'heldAccountId','currency','USD','exponent',2,'debitMinor','60','creditMinor','0'),
   jsonb_build_object('accountId',a->>'payableAccountId','currency','USD','exponent',2,'debitMinor','0','creditMinor','60'))));
 state:=public.commission_posting_state(key);
 if (state->>'releaseJournalId') is null then raise exception 'Release journal not visible in state'; end if;
 begin
  perform public.commission_posting_state('bad key with spaces');
  raise exception 'Invalid effect key accepted';
 exception when invalid_parameter_value then null; end;
end $$;
reset role;
-- Denials: authenticated callers get none of the posting surface, and
-- service_role still cannot reach the ledger directly (operator-only).
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000091","role":"authenticated","aal":"aal1"}',true);
do $$ begin
 begin
  perform public.get_or_create_commission_accounts('20000000-0000-4000-8000-000000000091','USD',2);
  raise exception 'Authenticated provisioning accepted';
 exception when insufficient_privilege then null; end;
 begin
  perform public.post_commission_journal('{}'::jsonb);
  raise exception 'Authenticated journal posting accepted';
 exception when insufficient_privilege then null; end;
 begin
  perform public.commission_posting_state('commission:order:6001:policy:1');
  raise exception 'Authenticated state probe accepted';
 exception when insufficient_privilege then null; end;
 begin
  perform 1 from public.list_commission_calculations();
  raise exception 'Authenticated scan accepted';
 exception when insufficient_privilege then null; end;
 begin
  perform 1 from ledger.accounts;
  raise exception 'Direct ledger read accepted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role service_role;
do $$ begin
 begin
  perform ledger.post_journal('{}'::jsonb);
  raise exception 'Direct ledger posting accepted for service_role';
 exception when insufficient_privilege then null; end;
 begin
  insert into ledger.accounts(affiliate_id,currency,exponent,bucket)
  values(null,'EUR',2,'expense');
  raise exception 'Direct ledger account insert accepted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
