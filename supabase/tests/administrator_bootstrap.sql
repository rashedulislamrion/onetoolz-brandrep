-- Nonproduction only, after the bootstrap migration. All fixtures rolled back.
begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-4000-8000-000000000021','bootstrap-confirmed@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000022','bootstrap-unconfirmed@example.invalid',null);
set local role authenticated;
do $$ begin
  begin
    perform public.bootstrap_initial_administrator('10000000-0000-4000-8000-000000000021','test operator','Synthetic authorization');
    raise exception 'Authenticated bootstrap accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role service_role;
do $$ begin
  begin
    perform public.bootstrap_initial_administrator('10000000-0000-4000-8000-000000000021','test operator','Synthetic authorization');
    raise exception 'Service role bootstrap accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  begin
    perform public.bootstrap_initial_administrator(null,'test operator','Synthetic authorization');
    raise exception 'Missing UUID accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.bootstrap_initial_administrator('10000000-0000-4000-8000-000000000022','test operator','Synthetic authorization');
    raise exception 'Unconfirmed bootstrap accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.bootstrap_initial_administrator('10000000-0000-4000-8000-000000000021','test operator','Synthetic authorization');
    raise exception 'No-factor bootstrap accepted';
  exception when insufficient_privilege then null; end;
end $$;
-- Synthetic database factor, NOT evidence of a live Auth enrollment test.
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at)
values ('10000000-0000-4000-8000-000000000023','10000000-0000-4000-8000-000000000021','Rollback fixture','totp','verified',now(),now());
do $$ declare v_id uuid; begin
  v_id := public.bootstrap_initial_administrator('10000000-0000-4000-8000-000000000021','test operator','Synthetic authorization');
  if not exists(select 1 from public.administrator_grant_events where id=v_id and target_user_id='10000000-0000-4000-8000-000000000021' and database_actor='postgres') then raise exception 'Missing bootstrap audit'; end if;
  if not exists(select 1 from public.user_roles where user_id='10000000-0000-4000-8000-000000000021' and role='admin') then raise exception 'Missing admin role'; end if;
  begin
    perform public.bootstrap_initial_administrator('10000000-0000-4000-8000-000000000021','test operator','Synthetic repeated authorization');
    raise exception 'Repeated bootstrap accepted';
  exception when invalid_parameter_value then null; end;
  begin
    update public.administrator_grant_events set reason='Changed reason' where id=v_id;
    raise exception 'Bootstrap audit mutation accepted';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.administrator_grant_events where id=v_id;
    raise exception 'Bootstrap audit deletion accepted';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
select jsonb_build_object('suite','administrator_bootstrap','assertions','passed','remaining_fixture_users',
 (select count(*) from auth.users where id in ('10000000-0000-4000-8000-000000000021','10000000-0000-4000-8000-000000000022'))) as verification;