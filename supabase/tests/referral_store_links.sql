-- Disposable/nonproduction only. Requires the identity, referral campaign
-- and referral evidence migrations plus 20261026010000_referral_store_links.
-- Never run these synthetic identity fixtures on production.
begin;
set local statement_timeout='20s';
insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-4000-8000-000000000101','storelink-one@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000102','storelink-two@example.invalid',now());
insert into auth.users(id,email) values
 ('10000000-0000-4000-8000-000000000103','storelink-unconfirmed@example.invalid');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal1"}',true);
do $$ declare v_id uuid; v_active boolean; v_created timestamptz; begin
 -- Create: returns a link id, status reports the active link.
 v_id := public.create_store_link(repeat('a',64));
 if v_id is null then raise exception 'Create returned no id'; end if;
 select active, created_at into v_active, v_created from public.store_link_status();
 if v_active is distinct from true or v_created is null then raise exception 'Status does not show active link'; end if;
 -- Direct table access stays denied in both directions.
 begin
  perform 1 from referral.store_links;
  raise exception 'Authenticated direct read allowed';
 exception when insufficient_privilege then null; end;
 begin
  insert into referral.store_links(user_id,token_hash) values ('10000000-0000-4000-8000-000000000101',repeat('f',64));
  raise exception 'Authenticated direct insert allowed';
 exception when insufficient_privilege then null; end;
 -- Malformed hashes are rejected before storage.
 begin
  perform public.create_store_link('not-a-hash');
  raise exception 'Malformed hash accepted';
 exception when invalid_parameter_value then null; end;
 -- Replace: generating a second link revokes the first; one active remains.
 -- (Verified from the owner role below; this role cannot read the table.)
 perform public.create_store_link(repeat('b',64));
end $$;
reset role;
-- The assertions above ran as `authenticated`, whose direct reads are denied,
-- so active-row counts are verified from the owner role here and below.
do $$ begin
 if (select count(*) from referral.store_links where user_id='10000000-0000-4000-8000-000000000101') <> 2
  then raise exception 'Replacement did not retain revoked history'; end if;
 if (select count(*) from referral.store_links where user_id='10000000-0000-4000-8000-000000000101' and revoked_at is null) <> 1
  then raise exception 'Replacement left other than one active link'; end if;
 if (select revoked_at is not null from referral.store_links where token_hash=repeat('a',64)) is distinct from true
  then raise exception 'Replaced link was not revoked'; end if;
end $$;
set local role service_role;
do $$ begin
 -- Resolve: active hash resolves, replaced hash no longer does.
 if public.resolve_store_link(repeat('b',64)) is distinct from '10000000-0000-4000-8000-000000000101'
  then raise exception 'Active link did not resolve'; end if;
 if public.resolve_store_link(repeat('a',64)) is not null then raise exception 'Revoked link resolved'; end if;
 if public.resolve_store_link(repeat('9',64)) is not null then raise exception 'Unknown hash resolved'; end if;
 if public.resolve_store_link('not-a-hash') is not null then raise exception 'Malformed hash resolved'; end if;
 -- The bridge role cannot mint links for arbitrary users.
 begin
  perform public.create_store_link(repeat('c',64));
  raise exception 'Service role created a link';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal1"}',true);
do $$ declare v_active boolean; begin
 -- Revoke: status flips to inactive and resolution stops.
 perform public.revoke_store_link();
 select active into v_active from public.store_link_status();
 if v_active is distinct from false then raise exception 'Status still active after revoke'; end if;
 -- Revoking with no active link is a harmless no-op.
 perform public.revoke_store_link();
end $$;
reset role;
set local role service_role;
do $$ begin
 if public.resolve_store_link(repeat('b',64)) is not null then raise exception 'Revoked link still resolves'; end if;
end $$;
reset role;
set local role authenticated;
-- A second user is unaffected by the first user's lifecycle and sees only
-- their own (empty) status.
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000102","role":"authenticated","aal":"aal1"}',true);
do $$ declare v_active boolean; begin
 select active into v_active from public.store_link_status();
 if v_active is distinct from false then raise exception 'Cross-user status leak'; end if;
end $$;
-- Unconfirmed accounts cannot create links.
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000103","role":"authenticated","aal":"aal1"}',true);
do $$ begin
 begin
  perform public.create_store_link(repeat('d',64));
  raise exception 'Unconfirmed account created a link';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
 begin
  perform public.create_store_link(repeat('e',64));
  raise exception 'Anonymous create allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform public.resolve_store_link(repeat('b',64));
  raise exception 'Anonymous resolve allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Guard trigger: even the owner path used by fixtures cannot delete rows or
-- mutate anything except the revoke transition (exercised via RPCs above).
do $$ begin
 begin
  delete from referral.store_links where token_hash=repeat('a',64);
  raise exception 'Store link row was deletable';
 exception when insufficient_privilege then null; end;
 begin
  update referral.store_links set token_hash=repeat('8',64) where token_hash=repeat('a',64);
  raise exception 'Store link hash was mutable';
 exception when insufficient_privilege then null; end;
 if (select count(*) from referral.store_links where user_id='10000000-0000-4000-8000-000000000101') <> 2
  then raise exception 'Guard checks changed stored links'; end if;
end $$;
rollback;
