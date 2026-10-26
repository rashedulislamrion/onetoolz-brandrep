-- Nonproduction/disposable database ONLY; requires the identity, ledger,
-- publication, rounding (20261026020000), commission calculations
-- (20261026020100), commission posting (20261026030000), calculation
-- revisions (20261026050000), payouts (20261026060000) and admin
-- reconciliation (20261026070100) migrations. Never run on production.
-- Rollback-only fixture: the whole suite runs in one transaction and
-- discards its synthetic state.
begin;
set local statement_timeout='20s';

insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-4000-8000-000000000171','recon-admin@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000191','recon-affiliate@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('10000000-0000-4000-8000-000000000171','admin'),
 ('10000000-0000-4000-8000-000000000191','affiliate');
insert into public.affiliates(id,user_id,status) values
 ('20000000-0000-4000-8000-000000000291','10000000-0000-4000-8000-000000000191','approved');

-- Publish one USD policy (needed as the calculations' policy reference).
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000171","role":"authenticated","aal":"aal2"}',true);
do $$ declare revision integer; version integer; begin
 select coalesce(max(revision),0) into revision from public.program_settings_drafts;
 select coalesce(max(version),0) into version from public.program_policies;
 revision:=public.save_program_settings_draft(gen_random_uuid(),revision,1000,'USD','25',30,'manual','Synthetic reconciliation draft');
 version:=public.publish_program_policy(gen_random_uuid(),revision,version,2,'order_total','proportional','half_up','paid_completed','Synthetic reconciliation policy');
 perform set_config('test.policy_version', version::text, true);
end $$;
reset role;

-- Provision commission accounts for the affiliate.
set local role service_role;
do $$ declare a jsonb; begin
 a:=public.get_or_create_commission_accounts('20000000-0000-4000-8000-000000000291','USD',2);
 perform set_config('test.accounts_a', a::text, true);
end $$;
reset role;

-- Journal flows (postgres operator):
--   earn 100000 Dr expense / Cr held; release 40000 held -> payable;
--   reserve 15000 payable -> reserved; settle 15000 reserved -> clearing;
--   reversal 5000 Dr held / Cr expense.
-- Expected: expense outflow 95000; held 55000; payable 25000; reserved 0;
-- clearing 15000; destination total 95000; difference 0.
do $$ declare
 a jsonb := current_setting('test.accounts_a')::jsonb;
 v_reserved uuid; v_clearing uuid;
begin
 insert into ledger.accounts(affiliate_id,currency,exponent,bucket)
 values ('20000000-0000-4000-8000-000000000291','USD',2,'reserved') returning id into v_reserved;
 insert into ledger.accounts(affiliate_id,currency,exponent,bucket)
 values (null,'USD',2,'clearing')
 on conflict (affiliate_id,currency,bucket) do nothing;
 select id into v_clearing from ledger.accounts
  where affiliate_id is null and currency='USD' and bucket='clearing';
 perform ledger.post_journal(jsonb_build_object('effectKey','commission:fixture:recon-earn','currency','USD','exponent',2,
  'reason','Synthetic earn for reconciliation',
  'lines',jsonb_build_array(
   jsonb_build_object('accountId',a->>'expenseAccountId','currency','USD','exponent',2,'debitMinor','100000','creditMinor','0'),
   jsonb_build_object('accountId',a->>'heldAccountId','currency','USD','exponent',2,'debitMinor','0','creditMinor','100000'))));
 perform ledger.post_journal(jsonb_build_object('effectKey','commission:fixture:recon-release','currency','USD','exponent',2,
  'reason','Synthetic release for reconciliation',
  'lines',jsonb_build_array(
   jsonb_build_object('accountId',a->>'heldAccountId','currency','USD','exponent',2,'debitMinor','40000','creditMinor','0'),
   jsonb_build_object('accountId',a->>'payableAccountId','currency','USD','exponent',2,'debitMinor','0','creditMinor','40000'))));
 perform ledger.post_journal(jsonb_build_object('effectKey','payout:fixture:recon-reserve','currency','USD','exponent',2,
  'reason','Synthetic reservation for reconciliation',
  'lines',jsonb_build_array(
   jsonb_build_object('accountId',a->>'payableAccountId','currency','USD','exponent',2,'debitMinor','15000','creditMinor','0'),
   jsonb_build_object('accountId',v_reserved::text,'currency','USD','exponent',2,'debitMinor','0','creditMinor','15000'))));
 perform ledger.post_journal(jsonb_build_object('effectKey','payout:fixture:recon-settle','currency','USD','exponent',2,
  'reason','Synthetic settlement for reconciliation',
  'lines',jsonb_build_array(
   jsonb_build_object('accountId',v_reserved::text,'currency','USD','exponent',2,'debitMinor','15000','creditMinor','0'),
   jsonb_build_object('accountId',v_clearing::text,'currency','USD','exponent',2,'debitMinor','0','creditMinor','15000'))));
 perform ledger.post_journal(jsonb_build_object('effectKey','commission:fixture:recon-reversal','currency','USD','exponent',2,
  'reason','Synthetic refund reversal for reconciliation',
  'lines',jsonb_build_array(
   jsonb_build_object('accountId',a->>'heldAccountId','currency','USD','exponent',2,'debitMinor','5000','creditMinor','0'),
   jsonb_build_object('accountId',a->>'expenseAccountId','currency','USD','exponent',2,'debitMinor','0','creditMinor','5000'))));
end $$;

-- Recorded calculations: two qualified heads (200 + revised 300 -> 350),
-- one unqualified head (50), and the superseded revision-1 row (300) that
-- head-only counting must exclude.
set local role service_role;
do $$ declare v_version integer := current_setting('test.policy_version')::integer; begin
 perform public.record_commission_calculation(jsonb_build_object(
  'effectKey','commission:order:1001:policy:' || v_version, 'orderId','1001',
  'affiliateId','20000000-0000-4000-8000-000000000291', 'policyVersion',v_version,
  'currency','USD','currencyDecimals',2,'basis','order_total','refundRule','proportional','rounding','half_up',
  'basisMinor','10000','refundedBasisMinor','0','grossMinor','1000','reversalMinor','0','netMinor','300',
  'qualification','qualified','unqualifiedReason',null,'holdUntil','2026-11-25T00:00:00.000Z'));
 perform public.record_commission_calculation(jsonb_build_object(
  'effectKey','commission:order:1002:policy:' || v_version, 'orderId','1002',
  'affiliateId','20000000-0000-4000-8000-000000000291', 'policyVersion',v_version,
  'currency','USD','currencyDecimals',2,'basis','order_total','refundRule','proportional','rounding','half_up',
  'basisMinor','10000','refundedBasisMinor','0','grossMinor','1000','reversalMinor','0','netMinor','200',
  'qualification','qualified','unqualifiedReason',null,'holdUntil','2026-11-25T00:00:00.000Z'));
 perform public.record_commission_calculation(jsonb_build_object(
  'effectKey','commission:order:1003:policy:' || v_version, 'orderId','1003',
  'affiliateId','20000000-0000-4000-8000-000000000291', 'policyVersion',v_version,
  'currency','USD','currencyDecimals',2,'basis','order_total','refundRule','proportional','rounding','half_up',
  'basisMinor','10000','refundedBasisMinor','0','grossMinor','1000','reversalMinor','0','netMinor','50',
  'qualification','unqualified','unqualifiedReason','not_completed','holdUntil',null));
 perform public.record_commission_calculation(jsonb_build_object(
  'effectKey','commission:order:1001:policy:' || v_version || ':r2', 'orderId','1001',
  'affiliateId','20000000-0000-4000-8000-000000000291', 'policyVersion',v_version,
  'currency','USD','currencyDecimals',2,'basis','order_total','refundRule','proportional','rounding','half_up',
  'basisMinor','10000','refundedBasisMinor','0','grossMinor','1000','reversalMinor','0','netMinor','350',
  'qualification','qualified','unqualifiedReason',null,'holdUntil','2026-11-25T00:00:00.000Z',
  'supersedesEffectKey','commission:order:1001:policy:' || v_version));
end $$;
reset role;

-- Payout requests in three statuses for the same currency.
insert into payouts.payout_requests(request_key,affiliate_id,currency,exponent,amount_minor,status,external_reference) values
 ('recon-settled-1','20000000-0000-4000-8000-000000000291','USD',2,'15000','settled','BKASH-FIXTURE-1'),
 ('recon-requested-1','20000000-0000-4000-8000-000000000291','USD',2,'7000','requested',null),
 ('recon-cancelled-1','20000000-0000-4000-8000-000000000291','USD',2,'3000','cancelled',null);

-- The AAL2 administrator reads a reconciling USD overview.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000171","role":"authenticated","aal":"aal2"}',true);
do $$ declare v jsonb; c jsonb; e jsonb; begin
 v:=public.admin_reconciliation_overview();
 if jsonb_array_length(v->'currencies') <> 1 then raise exception 'Exactly one currency expected'; end if;
 c:=v->'currencies'->0;
 if c->>'currency'<>'USD' or c->>'exponent'<>'2'
  or c->>'expenseDebitsMinor'<>'95000' or c->>'heldMinor'<>'55000'
  or c->>'payableMinor'<>'25000' or c->>'reservedMinor'<>'0'
  or c->>'disputedMinor'<>'0' or c->>'recoveryMinor'<>'0'
  or c->>'clearingMinor'<>'15000' or c->>'destinationTotalMinor'<>'95000'
  or c->>'differenceMinor'<>'0'
  then raise exception 'Reconciliation figures do not match the journal fixture'; end if;
 select entry into e from jsonb_array_elements(c->'calculations') entry where entry->>'qualification'='qualified';
 if e->>'count'<>'2' or e->>'netMinor'<>'550'
  then raise exception 'Qualified head counts must exclude the superseded revision'; end if;
 select entry into e from jsonb_array_elements(c->'calculations') entry where entry->>'qualification'='unqualified';
 if e->>'count'<>'1' or e->>'netMinor'<>'50'
  then raise exception 'Unqualified head counts are wrong'; end if;
 select entry into e from jsonb_array_elements(c->'payouts') entry where entry->>'status'='settled';
 if e->>'count'<>'1' or e->>'amountMinor'<>'15000'
  then raise exception 'Settled payout counts are wrong'; end if;
 select entry into e from jsonb_array_elements(c->'payouts') entry where entry->>'status'='requested';
 if e->>'count'<>'1' or e->>'amountMinor'<>'7000'
  then raise exception 'Requested payout counts are wrong'; end if;
 select entry into e from jsonb_array_elements(c->'payouts') entry where entry->>'status'='cancelled';
 if e->>'count'<>'1' or e->>'amountMinor'<>'3000'
  then raise exception 'Cancelled payout counts are wrong'; end if;
end $$;

-- An AAL1 administrator is denied: reconciliation requires MFA.
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000171","role":"authenticated","aal":"aal1"}',true);
do $$ begin
 begin
  perform public.admin_reconciliation_overview();
  raise exception 'AAL1 reconciliation read accepted';
 exception when insufficient_privilege then null; end;
end $$;

-- An affiliate (even at AAL2) is denied: no administrator role.
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000191","role":"authenticated","aal":"aal2"}',true);
do $$ begin
 begin
  perform public.admin_reconciliation_overview();
  raise exception 'Affiliate reconciliation read accepted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
