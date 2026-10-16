-- Nonproduction only; run as postgres in ONE request. No persistent fixtures.
begin;
insert into auth.users(id, email, email_confirmed_at) values
 ('10000000-0000-4000-8000-000000000011', 'extended-applicant@example.invalid', now()),
 ('10000000-0000-4000-8000-000000000012', 'extended-admin@example.invalid', now()),
 ('10000000-0000-4000-8000-000000000013', 'extended-unverified@example.invalid', null);
insert into public.user_roles(user_id, role) values ('10000000-0000-4000-8000-000000000012', 'admin');
set local role anon;
do $$ begin
  begin
    perform public.submit_affiliate_application('Anonymous', 'https://example.invalid', repeat('x', 40));
    raise exception 'Anonymous submission accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.review_affiliate_application(gen_random_uuid(), 'approved', 'Anonymous attempt');
    raise exception 'Anonymous review accepted';
  exception when insufficient_privilege then null; end;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000013","role":"authenticated","aal":"aal1"}', true);
do $$ begin
  begin
    perform public.submit_affiliate_application('Unverified', 'https://example.invalid', repeat('x', 40));
    raise exception 'Unverified submission accepted';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000011","role":"authenticated","aal":"aal1"}', true);
do $$ begin
  begin
    perform public.submit_affiliate_application('A', 'https://example.invalid', repeat('x', 40));
    raise exception 'Invalid name accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.submit_affiliate_application('Valid Name', 'http://example.invalid', repeat('x', 40));
    raise exception 'Insecure URL accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.submit_affiliate_application('Valid Name', 'https://example.invalid', 'short');
    raise exception 'Short plan accepted';
  exception when invalid_parameter_value then null; end;
  perform public.submit_affiliate_application('Valid Name', 'https://example.invalid', repeat('x', 40));
end $$;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000012","role":"authenticated","aal":"aal1"}', true);
do $$ begin
  begin
    perform public.review_affiliate_application(gen_random_uuid(), 'approved', 'AAL1 review');
    raise exception 'AAL1 review accepted';
  exception when insufficient_privilege then null; end;
  if exists (select 1 from public.affiliate_applications where user_id='10000000-0000-4000-8000-000000000011') then raise exception 'AAL1 disclosure'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000012","role":"authenticated","aal":"aal2"}', true);
do $$ declare v_id uuid; v_self uuid; begin
  v_self := public.submit_affiliate_application('Administrator', 'https://example.invalid', repeat('x', 40));
  begin
    perform public.review_affiliate_application(v_self, 'approved', 'Self approval');
    raise exception 'Self approval accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.review_affiliate_application(v_self, 'rejected', 'Self rejection');
    raise exception 'Self rejection accepted';
  exception when insufficient_privilege then null; end;
  select id into strict v_id from public.affiliate_applications where user_id='10000000-0000-4000-8000-000000000011';
  begin
    perform public.review_affiliate_application(v_id, 'pending', 'Invalid decision');
    raise exception 'Invalid decision accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.review_affiliate_application(v_id, 'approved', '  ');
    raise exception 'Blank reason accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.review_affiliate_application(gen_random_uuid(), 'approved', 'Missing application');
    raise exception 'Missing application accepted';
  exception when no_data_found then null; end;
  perform public.review_affiliate_application(v_id, 'rejected', 'Synthetic rejection');
  perform public.review_affiliate_application(v_id, 'rejected', 'Repeated rejection');
  begin
    perform public.review_affiliate_application(v_id, 'approved', 'Conflicting decision');
    raise exception 'Decision was overwritten';
  exception when invalid_parameter_value then null; end;
  if (select count(*) from public.application_events where application_id=v_id) <> 2 then raise exception 'Rejection audit count'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000011","role":"authenticated","aal":"aal1"}', true);
do $$ begin
  if exists(select 1 from public.affiliates) or exists(select 1 from public.user_roles) then raise exception 'Rejected user gained privileges'; end if;
  perform public.submit_affiliate_application('Changed Name', 'https://example.invalid', repeat('y', 40));
  if not exists(select 1 from public.affiliate_applications where status='rejected' and display_name='Valid Name') then raise exception 'Resubmission changed decision'; end if;
  if (select count(*) from public.application_events) <> 2 then raise exception 'Resubmission changed audit'; end if;
end $$;
reset role;
do $$ begin
  begin
    delete from public.application_events where actor_id='10000000-0000-4000-8000-000000000011';
    raise exception 'Audit deletion accepted';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
select jsonb_build_object('suite','identity_extended','assertions','passed','remaining_fixture_users',
 (select count(*) from auth.users where id in ('10000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000013'))) as verification;