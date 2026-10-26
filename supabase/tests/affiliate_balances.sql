-- Nonproduction/disposable database ONLY; requires the identity, ledger,
-- commission posting (20261026030000, for account provisioning) and
-- affiliate balances (20261026070000) migrations. Never run on
-- production. Rollback-only fixture: the whole suite runs in one
-- transaction and discards its synthetic state.
begin;
set local statement_timeout='20s';

insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-4000-8000-000000000151','bal-affiliate-a@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000152','bal-affiliate-b@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000153','bal-plain@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('10000000-0000-4000-8000-000000000151','affiliate'),
 ('10000000-0000-4000-8000-000000000152','affiliate');
insert into public.affiliates(id,user_id,status) values
 ('20000000-0000-4000-8000-000000000161','10000000-0000-4000-8000-000000000151','approved'),
 ('20000000-0000-4000-8000-000000000162','10000000-0000-4000-8000-000000000152','approved');

-- Provision commission accounts (platform expense singleton + held/payable
-- per affiliate) through the Phase 4 service-role surface.
set local role service_role;
do $$ declare a jsonb; b jsonb; begin
 a:=public.get_or_create_commission_accounts('20000000-0000-4000-8000-000000000161','USD',2);
 b:=public.get_or_create_commission_accounts('20000000-0000-4000-8000-000000000162','USD',2);
 perform set_config('test.accounts_a', a::text, true);
 perform set_config('test.accounts_b', b::text, true);
end $$;
reset role;

-- Affiliate A also holds reserved/disputed/recovery accounts.
insert into ledger.accounts(affiliate_id,currency,exponent,bucket) values
 ('20000000-0000-4000-8000-000000000161','USD',2,'reserved'),
 ('20000000-0000-4000-8000-000000000161','USD',2,'disputed'),
 ('20000000-0000-4000-8000-000000000161','USD',2,'recovery');

-- Journal flows (posted as the postgres operator, the only role
-- ledger.post_journal accepts):
--   A: earn 100000 to held, release 40000 held -> payable,
--      reserve 10000 payable -> reserved, dispute 3000 held -> disputed.
--   B: earn 5000 to held. Recovery account stays line-free (exact zero).
do $$ declare
 a jsonb := current_setting('test.accounts_a')::jsonb;
 b jsonb := current_setting('test.accounts_b')::jsonb;
 v_reserved uuid; v_disputed uuid;
begin
 select id into v_reserved from ledger.accounts
  where affiliate_id='20000000-0000-4000-8000-000000000161' and currency='USD' and bucket='reserved';
 select id into v_disputed from ledger.accounts
  where affiliate_id='20000000-0000-4000-8000-000000000161' and currency='USD' and bucket='disputed';
 perform ledger.post_journal(jsonb_build_object('effectKey','commission:fixture:bal-earn-a','currency','USD','exponent',2,
  'reason','Synthetic earn for affiliate A balances',
  'lines',jsonb_build_array(
   jsonb_build_object('accountId',a->>'expenseAccountId','currency','USD','exponent',2,'debitMinor','100000','creditMinor','0'),
   jsonb_build_object('accountId',a->>'heldAccountId','currency','USD','exponent',2,'debitMinor','0','creditMinor','100000'))));
 perform ledger.post_journal(jsonb_build_object('effectKey','commission:fixture:bal-release-a','currency','USD','exponent',2,
  'reason','Synthetic hold release for affiliate A balances',
  'lines',jsonb_build_array(
   jsonb_build_object('accountId',a->>'heldAccountId','currency','USD','exponent',2,'debitMinor','40000','creditMinor','0'),
   jsonb_build_object('accountId',a->>'payableAccountId','currency','USD','exponent',2,'debitMinor','0','creditMinor','40000'))));
 perform ledger.post_journal(jsonb_build_object('effectKey','payout:fixture:bal-reserve-a','currency','USD','exponent',2,
  'reason','Synthetic payout reservation for affiliate A balances',
  'lines',jsonb_build_array(
   jsonb_build_object('accountId',a->>'payableAccountId','currency','USD','exponent',2,'debitMinor','10000','creditMinor','0'),
   jsonb_build_object('accountId',v_reserved::text,'currency','USD','exponent',2,'debitMinor','0','creditMinor','10000'))));
 perform ledger.post_journal(jsonb_build_object('effectKey','commission:fixture:bal-dispute-a','currency','USD','exponent',2,
  'reason','Synthetic dispute hold for affiliate A balances',
  'lines',jsonb_build_array(
   jsonb_build_object('accountId',a->>'heldAccountId','currency','USD','exponent',2,'debitMinor','3000','creditMinor','0'),
   jsonb_build_object('accountId',v_disputed::text,'currency','USD','exponent',2,'debitMinor','0','creditMinor','3000'))));
 perform ledger.post_journal(jsonb_build_object('effectKey','commission:fixture:bal-earn-b','currency','USD','exponent',2,
  'reason','Synthetic earn for affiliate B balances',
  'lines',jsonb_build_array(
   jsonb_build_object('accountId',b->>'expenseAccountId','currency','USD','exponent',2,'debitMinor','5000','creditMinor','0'),
   jsonb_build_object('accountId',b->>'heldAccountId','currency','USD','exponent',2,'debitMinor','0','creditMinor','5000'))));
end $$;

-- Affiliate A sees exactly its own five bucket balances.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000151","role":"authenticated","aal":"aal1"}',true);
create temp table got_balances as select * from public.affiliate_ledger_balances();
do $$ begin
 if (select count(*) from got_balances) <> 5 then raise exception 'Affiliate A must see exactly five bucket rows'; end if;
 if not exists(select 1 from got_balances where currency='USD' and exponent=2 and bucket='held' and balance_minor='57000')
  then raise exception 'A held balance must be 57000'; end if;
 if not exists(select 1 from got_balances where currency='USD' and exponent=2 and bucket='payable' and balance_minor='30000')
  then raise exception 'A payable balance must be 30000'; end if;
 if not exists(select 1 from got_balances where currency='USD' and exponent=2 and bucket='reserved' and balance_minor='10000')
  then raise exception 'A reserved balance must be 10000'; end if;
 if not exists(select 1 from got_balances where currency='USD' and exponent=2 and bucket='disputed' and balance_minor='3000')
  then raise exception 'A disputed balance must be 3000'; end if;
 if not exists(select 1 from got_balances where currency='USD' and exponent=2 and bucket='recovery' and balance_minor='0')
  then raise exception 'A line-free recovery account must report an exact zero'; end if;
 if exists(select 1 from got_balances where balance_minor='5000')
  then raise exception 'Affiliate A must never see affiliate B balances'; end if;
end $$;
drop table got_balances;

-- Affiliate B sees only its own two accounts (held funded, payable exact zero).
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000152","role":"authenticated","aal":"aal1"}',true);
create temp table got_balances as select * from public.affiliate_ledger_balances();
do $$ begin
 if (select count(*) from got_balances) <> 2 then raise exception 'Affiliate B must see exactly two bucket rows'; end if;
 if not exists(select 1 from got_balances where currency='USD' and bucket='held' and balance_minor='5000')
  then raise exception 'B held balance must be 5000'; end if;
 if not exists(select 1 from got_balances where currency='USD' and bucket='payable' and balance_minor='0')
  then raise exception 'B payable account must report an exact zero'; end if;
end $$;
drop table got_balances;

-- A signed-in user with no affiliate row gets an EMPTY set, not zeros.
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000153","role":"authenticated","aal":"aal1"}',true);
do $$ begin
 if exists(select 1 from public.affiliate_ledger_balances())
  then raise exception 'A user without an affiliate must get an empty balance set'; end if;
end $$;

-- Anonymous callers are denied outright.
select set_config('request.jwt.claims','{}',true);
do $$ begin
 begin
  perform public.affiliate_ledger_balances();
  raise exception 'Anonymous balance read accepted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
