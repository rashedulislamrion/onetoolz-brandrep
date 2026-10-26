-- Nonproduction/disposable database ONLY; requires the publication
-- migrations, 20261026020000, 20261026020100, 20261026030000 and
-- 20261026050000_calculation_revisions.sql. Never run on production.
begin;
set local statement_timeout='20s';
insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-4000-8000-000000000071','rev-admin@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000091','rev-affiliate@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('10000000-0000-4000-8000-000000000071','admin'),
 ('10000000-0000-4000-8000-000000000091','affiliate');
insert into public.affiliates(id,user_id,status) values
 ('20000000-0000-4000-8000-000000000091','10000000-0000-4000-8000-000000000091','approved');
-- Publish one policy with the rounding/qualification signature.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000071","role":"authenticated","aal":"aal2"}',true);
do $$ declare revision integer; version integer; begin
 select coalesce(max(revision),0) into revision from public.program_settings_drafts;
 select coalesce(max(version),0) into version from public.program_policies;
 revision:=public.save_program_settings_draft(gen_random_uuid(),revision,1000,'USD','25',30,'manual','Synthetic revision draft');
 version:=public.publish_program_policy(gen_random_uuid(),revision,version,2,'net_items','proportional','half_up','paid_completed','Synthetic revision policy');
 perform set_config('test.policy_version',version::text,true);
end $$;
reset role;
-- First record: revision 1, no chain links; replay and v1 conflict
-- semantics are unchanged by the revision support.
set local role service_role;
do $$ declare v integer:=current_setting('test.policy_version')::integer;
 p1 jsonb; p2 jsonb; first_id uuid; replay_id uuid; second_id uuid; begin
 p1:=jsonb_build_object('effectKey','commission:order:8001:policy:'||v,'orderId','8001',
  'affiliateId','20000000-0000-4000-8000-000000000091','policyVersion',v,'currency','USD','currencyDecimals',2,
  'basis','net_items','refundRule','proportional','rounding','half_up','basisMinor','1000','refundedBasisMinor','200',
  'grossMinor','100','reversalMinor','20','netMinor','80','qualification','qualified','unqualifiedReason',null,
  'holdUntil','2026-11-15T10:00:00.000Z');
 first_id:=public.record_commission_calculation(p1);
 perform set_config('test.rev1_id',first_id::text,true);
 if (select revision from commissions.calculations where id=first_id)<>1
 or (select supersedes_id from commissions.calculations where id=first_id) is not null
 or (select superseded_by_id from commissions.calculations where id=first_id) is not null
 then raise exception 'First record chain state mismatch'; end if;
 replay_id:=public.record_commission_calculation(p1);
 if replay_id<>first_id then raise exception 'First-record replay mismatch'; end if;
 begin
  perform public.record_commission_calculation(p1 || jsonb_build_object(
   'effectKey','commission:order:8001:policy:'||v||':other'));
  raise exception 'Second head accepted without a supersede request';
 exception when invalid_parameter_value then null; end;
 -- Supersede the unposted head: refund grew, net drops 80 -> 50.
 p2:=p1 || jsonb_build_object('effectKey','commission:order:8001:policy:'||v||':r2',
  'refundedBasisMinor','500','reversalMinor','50','netMinor','50',
  'supersedesEffectKey','commission:order:8001:policy:'||v);
 second_id:=public.record_commission_calculation(p2);
 perform set_config('test.rev2_id',second_id::text,true);
 if second_id is null or second_id=first_id then raise exception 'Revision id mismatch'; end if;
 if (select superseded_by_id from commissions.calculations where id=first_id)<>second_id
 then raise exception 'Old head not marked superseded'; end if;
 if (select revision from commissions.calculations where id=second_id)<>2
 or (select supersedes_id from commissions.calculations where id=second_id)<>first_id
 or (select superseded_by_id from commissions.calculations where id=second_id) is not null
 then raise exception 'Revision chain state mismatch'; end if;
 if (select count(*) from commissions.calculations
  where order_id='8001' and policy_version=v and superseded_by_id is null)<>1
 then raise exception 'Exactly one head required'; end if;
 -- Idempotent replay of the same revision request.
 if public.record_commission_calculation(p2)<>second_id
 then raise exception 'Revision replay mismatch'; end if;
 -- A revision that changes nothing is a conflict, as is a wrong target.
 begin
  perform public.record_commission_calculation(p2 || jsonb_build_object(
   'effectKey','commission:order:8001:policy:'||v||':rX',
   'supersedesEffectKey','commission:order:8001:policy:'||v||':r2'));
  raise exception 'No-change revision accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.record_commission_calculation(p2 || jsonb_build_object(
   'effectKey','commission:order:8001:policy:'||v||':rY','netMinor','40',
   'supersedesEffectKey','commission:order:8001:policy:'||v));
  raise exception 'Stale supersede target accepted';
 exception when invalid_parameter_value then null; end;
 -- Double supersede: the chain increments to revision 3.
 perform public.record_commission_calculation(p2 || jsonb_build_object(
  'effectKey','commission:order:8001:policy:'||v||':r3','refundedBasisMinor','600',
  'reversalMinor','60','netMinor','40',
  'supersedesEffectKey','commission:order:8001:policy:'||v||':r2'));
 if (select revision from commissions.calculations
  where order_id='8001' and policy_version=v and superseded_by_id is null)<>3
 then raise exception 'Chain did not reach revision 3'; end if;
 if (select count(*) from commissions.calculations
  where order_id='8001' and policy_version=v)<>3
 then raise exception 'Chain length mismatch'; end if;
end $$;
reset role;
-- Totals count the HEAD only: one group, the revision-3 net, never the
-- superseded amounts alongside it.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000091","role":"authenticated","aal":"aal1"}',true);
do $$ begin
 if (select count(*) from public.affiliate_commission_totals())<>1
 then raise exception 'Totals should have exactly one group after revisions'; end if;
 if (select calculation_count from public.affiliate_commission_totals())<>1
 then raise exception 'Totals counted superseded rows'; end if;
 if (select net_minor from public.affiliate_commission_totals())<>'40'
 then raise exception 'Totals net is not the head net'; end if;
 begin
  perform public.record_commission_calculation('{}'::jsonb);
  raise exception 'Authenticated record accepted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Posting scan sees the head only, under its revision effect key.
set local role service_role;
do $$ declare v integer:=current_setting('test.policy_version')::integer; begin
 if (select count(*) from public.list_commission_calculations()
  where order_id='8001')<>1 then raise exception 'Posting scan saw superseded rows'; end if;
 if (select effect_key from public.list_commission_calculations()
  where order_id='8001')<>'commission:order:8001:policy:'||v||':r3'
 then raise exception 'Posting scan head mismatch'; end if;
end $$;
-- A head with posted journals can never be superseded (55000).
do $$ declare v integer:=current_setting('test.policy_version')::integer;
 a jsonb; key text; p3 jsonb; begin
 perform public.record_commission_calculation(jsonb_build_object(
  'effectKey','commission:order:8002:policy:'||v,'orderId','8002',
  'affiliateId','20000000-0000-4000-8000-000000000091','policyVersion',v,'currency','USD','currencyDecimals',2,
  'basis','net_items','refundRule','proportional','rounding','half_up','basisMinor','1000','refundedBasisMinor','200',
  'grossMinor','100','reversalMinor','20','netMinor','80','qualification','qualified','unqualifiedReason',null,
  'holdUntil','2026-11-15T10:00:00.000Z'));
 a:=public.get_or_create_commission_accounts('20000000-0000-4000-8000-000000000091','USD',2);
 key:='commission:order:8002:policy:'||v;
 perform public.post_commission_journal(jsonb_build_object('effectKey',key,'currency','USD','exponent',2,
  'reason','Commission earned for order 8002 under policy '||v,
  'lines',jsonb_build_array(
   jsonb_build_object('accountId',a->>'expenseAccountId','currency','USD','exponent',2,'debitMinor','80','creditMinor','0'),
   jsonb_build_object('accountId',a->>'heldAccountId','currency','USD','exponent',2,'debitMinor','0','creditMinor','80'))));
 p3:=jsonb_build_object('effectKey',key||':r2','orderId','8002',
  'affiliateId','20000000-0000-4000-8000-000000000091','policyVersion',v,'currency','USD','currencyDecimals',2,
  'basis','net_items','refundRule','proportional','rounding','half_up','basisMinor','1000','refundedBasisMinor','500',
  'grossMinor','100','reversalMinor','50','netMinor','50','qualification','qualified','unqualifiedReason',null,
  'holdUntil','2026-11-15T10:00:00.000Z','supersedesEffectKey',key);
 begin
  perform public.record_commission_calculation(p3);
  raise exception 'Posted head superseded';
 exception when object_not_in_prerequisite_state then null; end;
 if (select count(*) from commissions.calculations
  where order_id='8002' and policy_version=v)<>1
 then raise exception 'Refused revision left rows behind'; end if;
end $$;
reset role;
-- Guard rails in owner context: content updates, re-marking a superseded
-- row, deletes, and a hand-inserted second head are all rejected.
do $$ declare v integer:=current_setting('test.policy_version')::integer; begin
 begin
  update commissions.calculations set net_minor='0' where order_id='8001';
  raise exception 'Calculation content updated';
 exception when insufficient_privilege then null; end;
 begin
  update commissions.calculations set superseded_by_id=gen_random_uuid()
  where id=current_setting('test.rev1_id')::uuid;
  raise exception 'Superseded row re-marked';
 exception when insufficient_privilege then null; end;
 begin
  delete from commissions.calculations where order_id='8001';
  raise exception 'Calculation deleted';
 exception when insufficient_privilege then null; end;
 begin
  insert into commissions.calculations(effect_key,order_id,affiliate_id,policy_version,currency,
   currency_decimals,basis,refund_rule,rounding,basis_minor,refunded_basis_minor,gross_minor,
   reversal_minor,net_minor,qualification,unqualified_reason,hold_until,revision)
  values('commission:order:8001:policy:'||v||':sneaky','8001',
   '20000000-0000-4000-8000-000000000091',v,'USD',2,'net_items','proportional','half_up',
   '1000','0','100','0','100','qualified',null,'2026-11-15T10:00:00.000Z',99);
  raise exception 'Second head inserted';
 exception when unique_violation then null; end;
end $$;
rollback;
