-- Manual PostgreSQL integration test. Run ONLY in a disposable/staging database
-- after the migration, as postgres. Synthetic fixtures are rolled back.
begin;
insert into auth.users(id, email, email_confirmed_at)
values ('10000000-0000-4000-8000-000000000001', 'fixture-a@example.invalid', now()),
       ('10000000-0000-4000-8000-000000000002', 'fixture-b@example.invalid', now());

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}', true);
select public.submit_affiliate_application('Fixture A', 'https://example.invalid/a', 'A sufficiently detailed synthetic promotion plan for testing.');
select public.submit_affiliate_application('Fixture A', 'https://example.invalid/a', 'A sufficiently detailed synthetic promotion plan for testing.');
do $$ begin
  if (select count(*) from public.affiliate_applications) <> 1 then raise exception 'Owner read or idempotency failed'; end if;
  if (select count(*) from public.application_events) <> 1 then raise exception 'Duplicate history'; end if;
  begin
    insert into public.user_roles(user_id, role) values ('10000000-0000-4000-8000-000000000001', 'admin');
    raise exception 'Role escalation succeeded';
  exception when insufficient_privilege then null; end;
  begin
    update public.affiliate_applications set status = 'approved';
    raise exception 'Direct approval succeeded';
  exception when insufficient_privilege then null; end;
  begin
    perform public.review_affiliate_application((select id from public.affiliate_applications limit 1), 'approved', 'Unauthorized attempt');
    raise exception 'Non-admin review succeeded';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}', true);
do $$ begin
  if exists (select 1 from public.affiliate_applications) or exists (select 1 from public.application_events)
    or exists (select 1 from public.profiles) then raise exception 'Cross-user disclosure'; end if;
end $$;
reset role;
insert into public.user_roles(user_id, role) values ('10000000-0000-4000-8000-000000000002', 'admin');
set local role authenticated;
do $$ begin
  if exists (select 1 from public.affiliate_applications) then raise exception 'Admin without MFA can read applications'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
select public.review_affiliate_application((select id from public.affiliate_applications limit 1), 'approved', 'Synthetic approval test');
select public.review_affiliate_application((select id from public.affiliate_applications limit 1), 'approved', 'Synthetic repeated request');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}', true);
do $$ begin
  if not exists (select 1 from public.affiliates where status = 'approved') then raise exception 'Affiliate missing'; end if;
  if not exists (select 1 from public.user_roles where role = 'affiliate') then raise exception 'Affiliate role missing'; end if;
  if (select count(*) from public.application_events) <> 2 then raise exception 'Approval history mismatch'; end if;
end $$;
reset role;
do $$ begin
  begin
    update public.application_events set reason = 'Changed history';
    raise exception 'History mutation succeeded';
  exception when insufficient_privilege then null; end;
end $$;
rollback;