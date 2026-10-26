-- Nonproduction/disposable database ONLY; requires the identity, ledger,
-- publication, rounding (20261026020000), commission posting
-- (20261026030000) and payouts (20261026060000) migrations. Never run on
-- production. Rollback-only fixture: the whole suite runs in one
-- transaction and discards its synthetic state.
begin;
set local statement_timeout='20s';

create function pg_temp.bucket_balance(p_affiliate uuid, p_bucket text) returns numeric
language sql as $$
  select coalesce(sum(l.credit_minor - l.debit_minor), 0)::numeric
  from ledger.accounts a join ledger.lines l on l.account_id = a.id
  where a.affiliate_id = p_affiliate and a.bucket = p_bucket and a.currency = 'USD';
$$;
create function pg_temp.platform_balance(p_bucket text) returns numeric
language sql as $$
  select coalesce(sum(l.credit_minor - l.debit_minor), 0)::numeric
  from ledger.accounts a join ledger.lines l on l.account_id = a.id
  where a.affiliate_id is null and a.bucket = p_bucket and a.currency = 'USD';
$$;

insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-4000-8000-000000000071','pay-admin@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000091','pay-affiliate-a@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000092','pay-affiliate-b@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000093','pay-admin-affiliate@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000094','pay-plain@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('10000000-0000-4000-8000-000000000071','admin'),
 ('10000000-0000-4000-8000-000000000091','affiliate'),
 ('10000000-0000-4000-8000-000000000092','affiliate'),
 ('10000000-0000-4000-8000-000000000093','admin'),
 ('10000000-0000-4000-8000-000000000093','affiliate');
insert into public.affiliates(id,user_id,status) values
 ('20000000-0000-4000-8000-000000000091','10000000-0000-4000-8000-000000000091','approved'),
 ('20000000-0000-4000-8000-000000000092','10000000-0000-4000-8000-000000000092','approved'),
 ('20000000-0000-4000-8000-000000000093','10000000-0000-4000-8000-000000000093','approved');

-- Publish one USD policy: minimum payout 25.00, manual cadence.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000071","role":"authenticated","aal":"aal2"}',true);
do $$ declare revision integer; version integer; begin
 select coalesce(max(revision),0) into revision from public.program_settings_drafts;
 select coalesce(max(version),0) into version from public.program_policies;
 revision:=public.save_program_settings_draft(gen_random_uuid(),revision,1000,'USD','25',30,'manual','Synthetic payout draft');
 perform public.publish_program_policy(gen_random_uuid(),revision,version,2,'net_items','proportional','half_up','paid_completed','Synthetic payout policy');
end $$;
reset role;

-- Fund payable balances: A gets 1000.00, C gets 100.00, B gets nothing.
set local role service_role;
do $$ declare a jsonb; c jsonb; begin
 a:=public.get_or_create_commission_accounts('20000000-0000-4000-8000-000000000091','USD',2);
 c:=public.get_or_create_commission_accounts('20000000-0000-4000-8000-000000000093','USD',2);
 perform public.post_commission_journal(jsonb_build_object('effectKey','commission:fixture:fund-a','currency','USD','exponent',2,
  'reason','Synthetic payable funding for affiliate A',
  'lines',jsonb_build_array(
   jsonb_build_object('accountId',a->>'expenseAccountId','currency','USD','exponent',2,'debitMinor','100000','creditMinor','0'),
   jsonb_build_object('accountId',a->>'payableAccountId','currency','USD','exponent',2,'debitMinor','0','creditMinor','100000'))));
 perform public.post_commission_journal(jsonb_build_object('effectKey','commission:fixture:fund-c','currency','USD','exponent',2,
  'reason','Synthetic payable funding for affiliate C',
  'lines',jsonb_build_array(
   jsonb_build_object('accountId',c->>'expenseAccountId','currency','USD','exponent',2,'debitMinor','10000','creditMinor','0'),
   jsonb_build_object('accountId',c->>'payableAccountId','currency','USD','exponent',2,'debitMinor','0','creditMinor','10000'))));
end $$;
reset role;

-- Affiliate A: happy-path request reserves payable -> reserved atomically.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000091","role":"authenticated","aal":"aal1"}',true);
do $$ declare v_id uuid; v_again uuid; begin
 v_id:=public.request_payout('req-a-1','USD','10000');
 perform set_config('test.req_a_1',v_id::text,true);
 if (select status from payouts.payout_requests where id=v_id)<>'requested'
  then raise exception 'Request not in requested status'; end if;
 -- Idempotent replay returns the same row and moves nothing twice.
 v_again:=public.request_payout('req-a-1','USD','10000');
 if v_again<>v_id then raise exception 'Request replay returned a different id'; end if;
 begin
  perform public.request_payout('req-a-1','USD','10001');
  raise exception 'Conflicting request key accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.request_payout('req-a-low','USD','1000');
  raise exception 'Below-minimum request accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.request_payout('req-a-big','USD','999999');
  raise exception 'Insufficient-balance request accepted';
 exception when invalid_parameter_value then null; end;
 if pg_temp.bucket_balance('20000000-0000-4000-8000-000000000091','payable')<>90000
 or pg_temp.bucket_balance('20000000-0000-4000-8000-000000000091','reserved')<>10000
  then raise exception 'Reservation balances mismatch'; end if;
end $$;

-- Affiliate B: no balance to reserve, and cannot touch A's request.
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000092","role":"authenticated","aal":"aal1"}',true);
do $$ declare v_overview jsonb; begin
 begin
  perform public.request_payout('req-b-1','USD','5000');
  raise exception 'Unfunded affiliate request accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.cancel_payout(current_setting('test.req_a_1')::uuid);
  raise exception 'Cross-affiliate cancel accepted';
 exception when insufficient_privilege then null; end;
 v_overview:=public.affiliate_payout_overview();
 if jsonb_array_length(v_overview->'requests')<>0
  then raise exception 'Overview leaked another affiliate''s requests'; end if;
end $$;

-- Plain user: not an affiliate, cannot request; not an admin, cannot review.
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000094","role":"authenticated","aal":"aal2"}',true);
do $$ begin
 begin
  perform public.request_payout('req-plain-1','USD','5000');
  raise exception 'Non-affiliate request accepted';
 exception when insufficient_privilege then null; end;
 begin
  perform public.review_payout(current_setting('test.req_a_1')::uuid,'approve','Looks fine');
  raise exception 'Non-admin review accepted';
 exception when insufficient_privilege then null; end;
end $$;

-- Admin without MFA (aal1) cannot review.
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000071","role":"authenticated","aal":"aal1"}',true);
do $$ begin
 begin
  perform public.review_payout(current_setting('test.req_a_1')::uuid,'approve','Looks fine');
  raise exception 'AAL1 review accepted';
 exception when insufficient_privilege then null; end;
end $$;

-- Admin with MFA: approve keeps funds reserved; settle moves reserved ->
-- clearing only with a real reference, and is reference-idempotent.
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000071","role":"authenticated","aal":"aal2"}',true);
do $$ declare v_id uuid:=current_setting('test.req_a_1')::uuid; begin
 perform public.review_payout(v_id,'approve','Documents match');
 perform public.review_payout(v_id,'approve','Documents match');
 if (select status from payouts.payout_requests where id=v_id)<>'approved'
 or pg_temp.bucket_balance('20000000-0000-4000-8000-000000000091','reserved')<>10000
  then raise exception 'Approval moved money or lost the request'; end if;
 begin
  perform public.settle_payout(v_id,'ab');
  raise exception 'Short settlement reference accepted';
 exception when invalid_parameter_value then null; end;
 perform public.settle_payout(v_id,'BKASH-99887');
 perform public.settle_payout(v_id,'BKASH-99887');
 begin
  perform public.settle_payout(v_id,'OTHER-12345');
  raise exception 'Conflicting settlement reference accepted';
 exception when invalid_parameter_value then null; end;
 if (select status from payouts.payout_requests where id=v_id)<>'settled'
 or (select external_reference from payouts.payout_requests where id=v_id)<>'BKASH-99887'
 or pg_temp.bucket_balance('20000000-0000-4000-8000-000000000091','reserved')<>0
 or pg_temp.platform_balance('clearing')<>10000
  then raise exception 'Settlement balances mismatch'; end if;
end $$;

-- Reject releases the reservation; fail releases it too; cancel releases.
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000091","role":"authenticated","aal":"aal1"}',true);
do $$ begin
 perform set_config('test.req_a_2',public.request_payout('req-a-2','USD','5000')::text,true);
 perform set_config('test.req_a_3',public.request_payout('req-a-3','USD','5000')::text,true);
 perform set_config('test.req_a_4',public.request_payout('req-a-4','USD','5000')::text,true);
 if pg_temp.bucket_balance('20000000-0000-4000-8000-000000000091','payable')<>75000
 or pg_temp.bucket_balance('20000000-0000-4000-8000-000000000091','reserved')<>15000
  then raise exception 'Open-request balances mismatch'; end if;
 perform public.cancel_payout(current_setting('test.req_a_4')::uuid);
 perform public.cancel_payout(current_setting('test.req_a_4')::uuid);
 if (select status from payouts.payout_requests where request_key='req-a-4')<>'cancelled'
 or pg_temp.bucket_balance('20000000-0000-4000-8000-000000000091','reserved')<>10000
  then raise exception 'Cancel did not release exactly once'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000071","role":"authenticated","aal":"aal2"}',true);
do $$ begin
 perform public.review_payout(current_setting('test.req_a_2')::uuid,'reject','Documents mismatch');
 perform public.review_payout(current_setting('test.req_a_3')::uuid,'approve','Documents match');
 perform public.fail_payout(current_setting('test.req_a_3')::uuid,'Bank rejected the transfer');
 if (select status from payouts.payout_requests where request_key='req-a-2')<>'rejected'
 or (select status from payouts.payout_requests where request_key='req-a-3')<>'failed'
 or (select failure_reason from payouts.payout_requests where request_key='req-a-3')<>'Bank rejected the transfer'
 or pg_temp.bucket_balance('20000000-0000-4000-8000-000000000091','payable')<>90000
 or pg_temp.bucket_balance('20000000-0000-4000-8000-000000000091','reserved')<>0
  then raise exception 'Reject/fail release balances mismatch'; end if;
 -- Terminal states refuse further transitions.
 begin
  perform public.review_payout(current_setting('test.req_a_2')::uuid,'approve','Second look');
  raise exception 'Rejected payout re-reviewed';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.fail_payout(current_setting('test.req_a_1')::uuid,'Too late');
  raise exception 'Settled payout marked failed';
 exception when invalid_parameter_value then null; end;
end $$;

-- Maker-checker: C is both admin and affiliate; C cannot review its own
-- request, but the independent administrator can.
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000093","role":"authenticated","aal":"aal2"}',true);
do $$ begin
 perform set_config('test.req_c_1',public.request_payout('req-c-1','USD','5000')::text,true);
 begin
  perform public.review_payout(current_setting('test.req_c_1')::uuid,'approve','Self approval');
  raise exception 'Self-review accepted';
 exception when insufficient_privilege then null; end;
 begin
  perform public.settle_payout(current_setting('test.req_c_1')::uuid,'SELF-12345');
  raise exception 'Self-settle path accepted';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000071","role":"authenticated","aal":"aal2"}',true);
do $$ begin
 perform public.review_payout(current_setting('test.req_c_1')::uuid,'approve','Independent review');
 if (select status from payouts.payout_requests where request_key='req-c-1')<>'approved'
  then raise exception 'Independent review did not approve'; end if;
 if (select count(*) from public.admin_payout_queue())<>1
  then raise exception 'Admin queue should hold only the approved C request'; end if;
end $$;

-- Final overview for A: settled request carries its reference; balances are
-- exact after the full lifecycle.
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000091","role":"authenticated","aal":"aal1"}',true);
do $$ declare v_overview jsonb; v_currency jsonb; begin
 v_overview:=public.affiliate_payout_overview();
 select value into v_currency from jsonb_array_elements(v_overview->'currencies') value
  where value->>'currency'='USD';
 if v_currency->>'payableMinor'<>'90000' or v_currency->>'reservedMinor'<>'0'
 or v_currency->>'minimumPayoutMinor'<>'2500' or v_currency->>'payoutCadence'<>'manual'
  then raise exception 'Final overview currency mismatch'; end if;
 if jsonb_array_length(v_overview->'requests')<>4
  then raise exception 'Final overview request count mismatch'; end if;
 if not exists(select 1 from jsonb_array_elements(v_overview->'requests') r
   where r->>'requestKey'='req-a-1' and r->>'status'='settled' and r->>'externalReference'='BKASH-99887')
  then raise exception 'Settled request missing from overview'; end if;
 if (select count(*) from payouts.payout_events e
   join payouts.payout_requests r on r.id=e.request_id where r.request_key='req-a-1')<>3
  then raise exception 'Payout event history incomplete'; end if;
end $$;
reset role;
rollback;
