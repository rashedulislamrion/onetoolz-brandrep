-- Nonproduction only. Run after the ledger migration; all fixtures roll back.
begin;
set local statement_timeout = '20s';
insert into ledger.currencies(code,exponent) values ('XTS',2);
insert into ledger.accounts(id,currency,exponent,bucket) values
 ('20000000-0000-4000-8000-000000000001','XTS',2,'expense'),
 ('20000000-0000-4000-8000-000000000002','XTS',2,'clearing');
create function pg_temp.fixture(p_key text default 'test:ledger:one', p_amount text default '9007199254740993')
returns jsonb language sql as $$
 select jsonb_build_object('effectKey',p_key,'currency','XTS','exponent',2,'reason','Synthetic ledger test',
 'lines',jsonb_build_array(
 jsonb_build_object('accountId','20000000-0000-4000-8000-000000000001','currency','XTS','exponent',2,'debitMinor',p_amount,'creditMinor','0'),
 jsonb_build_object('accountId','20000000-0000-4000-8000-000000000002','currency','XTS','exponent',2,'debitMinor','0','creditMinor',p_amount)))
$$;
create function pg_temp.expect_error(p_sql text, p_state text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_state then return; end if;
    raise;
  end;
  raise exception 'Expected SQLSTATE % for %', p_state, p_sql;
end;
$$;
do $$ declare v_id uuid; v_retry uuid; v_reversal uuid; v_payload jsonb; v_role text; v_table text; begin
  foreach v_role in array array['anon','authenticated','service_role'] loop
    if has_schema_privilege(v_role,'ledger','USAGE')
      or has_function_privilege(v_role,'ledger.post_journal(jsonb,uuid)','EXECUTE') then
      raise exception 'Unexpected ledger privilege for %', v_role;
    end if;
    foreach v_table in array array['currencies','accounts','journals','lines'] loop
      if has_table_privilege(v_role,'ledger.' || v_table,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then
        raise exception 'Unexpected table privilege for %', v_role;
      end if;
    end loop;
  end loop;
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='ledger' and c.relkind='r' and c.relrowsecurity) <> 4 then
    raise exception 'RLS missing';
  end if;
  v_id := ledger.post_journal(pg_temp.fixture());
  v_retry := ledger.post_journal(pg_temp.fixture());
  if v_id <> v_retry or (select count(*) from ledger.journals) <> 1 then raise exception 'Retry duplicated'; end if;
  if (select sum(debit_minor) from ledger.lines where journal_id=v_id) <> 9007199254740993 then raise exception 'Lost precision'; end if;
  perform pg_temp.expect_error($q$select ledger.post_journal(pg_temp.fixture('test:ledger:one','10'))$q$,'22023');
  perform pg_temp.expect_error($q$select ledger.post_journal(jsonb_set(pg_temp.fixture(),'{reason}','"Changed reason"'))$q$,'22023');
  perform pg_temp.expect_error($q$select ledger.post_journal(null)$q$,'22023');
  perform pg_temp.expect_error($q$select ledger.post_journal('{}')$q$,'22023');
  perform pg_temp.expect_error($q$select ledger.post_journal(jsonb_set(pg_temp.fixture(),'{lines}','{}'))$q$,'22023');
  perform pg_temp.expect_error($q$select ledger.post_journal(jsonb_set(pg_temp.fixture(),'{lines,0,debitMinor}','100'))$q$,'22023');
  perform pg_temp.expect_error($q$select ledger.post_journal(pg_temp.fixture('test:invalid','01'))$q$,'22023');
  perform pg_temp.expect_error($q$select ledger.post_journal(pg_temp.fixture('test:invalid','9223372036854775808'))$q$,'22023');
  perform pg_temp.expect_error($q$select ledger.post_journal(pg_temp.fixture('test:invalid','0'))$q$,'22023');
  perform pg_temp.expect_error($q$select ledger.post_journal(jsonb_set(pg_temp.fixture(),'{lines,0,debitMinor}','"1"'))$q$,'22023');
  perform pg_temp.expect_error($q$select ledger.post_journal(jsonb_set(pg_temp.fixture(),'{lines,0,currency}','"USD"'))$q$,'22023');
  perform pg_temp.expect_error($q$select ledger.post_journal(jsonb_set(pg_temp.fixture(),'{lines,0,exponent}','3'))$q$,'22023');
  perform pg_temp.expect_error($q$select ledger.post_journal(jsonb_set(pg_temp.fixture('test:unknown'),'{lines,0,accountId}','"20000000-0000-4000-8000-000000000099"'))$q$,'22023');
  perform pg_temp.expect_error($q$select ledger.post_journal(jsonb_set(pg_temp.fixture('test:self'),'{lines,1,accountId}','"20000000-0000-4000-8000-000000000001"'))$q$,'22023');
  perform pg_temp.expect_error($q$update ledger.journals set reason='Changed reason'$q$,'42501');
  perform pg_temp.expect_error($q$delete from ledger.lines$q$,'42501');
  perform pg_temp.expect_error($q$update ledger.accounts set bucket='clearing'$q$,'42501');
  perform pg_temp.expect_error($q$delete from ledger.currencies$q$,'42501');
  -- Full reversal is linked, unique and exactly compensating; partial adjustments are future policy work.
  select jsonb_agg(jsonb_build_object('accountId',account_id::text,'currency',currency,'exponent',exponent,
    'debitMinor',credit_minor::text,'creditMinor',debit_minor::text) order by line_no) into v_payload
    from ledger.lines where journal_id=v_id;
  v_payload := jsonb_set(pg_temp.fixture('test:reverse'),'{lines}',v_payload);
  v_reversal := ledger.post_journal(v_payload,v_id);
  if ledger.post_journal(v_payload,v_id) <> v_reversal then raise exception 'Reversal retry duplicated'; end if;
  perform pg_temp.expect_error(format('select ledger.post_journal(%L::jsonb,%L::uuid)',
    jsonb_set(v_payload,'{effectKey}','"test:reverse:duplicate"'),v_id),'23505');
  perform pg_temp.expect_error(format('select ledger.post_journal(pg_temp.fixture(''test:bad-reverse'',''1''),%L::uuid)',v_reversal),'22023');
end $$;
set constraints all immediate;
select pg_temp.expect_error('truncate ledger.lines','42501');
set constraints all deferred;
-- Deferred constraints must also catch direct owner inserts that bypass the function.
do $$ declare v_id uuid; begin
  begin
    insert into ledger.journals(effect_key,currency,exponent,reason,payload)
      values('test:orphan','XTS',2,'Orphan fixture',pg_temp.fixture()->'lines');
    set constraints all immediate;
    raise exception 'Orphan accepted';
  exception when check_violation then null; end;
  select id into v_id from ledger.journals where effect_key='test:ledger:one';
  begin
    insert into ledger.lines select journal_id,line_no+2,account_id,currency,exponent,debit_minor,credit_minor
      from ledger.lines where journal_id=v_id;
    set constraints all immediate;
    raise exception 'Balanced late append accepted';
  exception when check_violation then null; end;
end $$;
set local role anon;
do $$ begin
  begin perform ledger.post_journal('{}'); raise exception 'Anonymous posting accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin perform 1 from ledger.lines; raise exception 'Authenticated ledger read accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role service_role;
do $$ begin
  begin perform ledger.post_journal('{}'); raise exception 'Service posting accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set constraints all immediate;
rollback;
select 'ledger rollback suite passed' as verification;