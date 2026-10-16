-- Applied to nonproduction as 20261015135651. No seeds or application grants.
begin;
create schema ledger;
revoke all on schema ledger from public, anon, authenticated, service_role;

create table ledger.currencies (
  code text primary key check (code ~ '^[A-Z]{3}$'),
  exponent integer not null check (exponent between 0 and 6),
  unique(code, exponent)
);
create table ledger.accounts (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid references public.affiliates(id) on delete restrict,
  currency text not null,
  exponent integer not null,
  bucket text not null check (bucket in ('expense','clearing','held','payable','reserved','disputed','recovery')),
  created_at timestamptz not null default now(),
  foreign key(currency, exponent) references ledger.currencies(code, exponent) on delete restrict,
  check ((affiliate_id is null) = (bucket in ('expense','clearing'))),
  unique nulls not distinct(affiliate_id, currency, bucket),
  unique(id, currency, exponent)
);
create table ledger.journals (
  id uuid primary key default gen_random_uuid(),
  effect_key text not null unique check (effect_key ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{2,199}$'),
  currency text not null,
  exponent integer not null,
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  payload jsonb not null check (jsonb_typeof(payload) = 'array' and jsonb_array_length(payload) between 2 and 200),
  reverses uuid unique references ledger.journals(id) on delete restrict,
  database_actor text not null default current_user,
  created_at timestamptz not null default now(),
  foreign key(currency, exponent) references ledger.currencies(code, exponent) on delete restrict,
  unique(id, currency, exponent)
);
create table ledger.lines (
  journal_id uuid not null,
  line_no integer not null check (line_no between 1 and 200),
  account_id uuid not null,
  currency text not null,
  exponent integer not null,
  debit_minor bigint not null check (debit_minor >= 0),
  credit_minor bigint not null check (credit_minor >= 0),
  primary key(journal_id, line_no),
  check ((debit_minor > 0 and credit_minor = 0) or (credit_minor > 0 and debit_minor = 0)),
  foreign key(journal_id, currency, exponent) references ledger.journals(id, currency, exponent) on delete restrict,
  foreign key(account_id, currency, exponent) references ledger.accounts(id, currency, exponent) on delete restrict
);
create index ledger_lines_account on ledger.lines(account_id, journal_id);

alter table ledger.currencies enable row level security;
alter table ledger.accounts enable row level security;
alter table ledger.journals enable row level security;
alter table ledger.lines enable row level security;
revoke all on all tables in schema ledger from public, anon, authenticated, service_role;

create function ledger.reject_change() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'Ledger records are append-only' using errcode = '42501';
end;
$$;
create trigger currencies_immutable before update or delete or truncate on ledger.currencies
for each statement execute function ledger.reject_change();
create trigger accounts_immutable before update or delete or truncate on ledger.accounts
for each statement execute function ledger.reject_change();
create trigger journals_immutable before update or delete or truncate on ledger.journals
for each statement execute function ledger.reject_change();
create trigger lines_immutable before update or delete or truncate on ledger.lines
for each statement execute function ledger.reject_change();

-- The stored line snapshot makes later INSERTs fail, even balanced additions.
create function ledger.assert_complete() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
  v_journal ledger.journals%rowtype;
  v_payload jsonb;
  v_debit numeric;
  v_credit numeric;
  v_accounts integer;
  v_reverse jsonb;
begin
  if tg_table_name = 'journals' then v_id := new.id; else v_id := new.journal_id; end if;
  select * into strict v_journal from ledger.journals where id = v_id;
  select sum(debit_minor), sum(credit_minor), count(distinct account_id),
    jsonb_agg(jsonb_build_object('accountId',account_id::text,'currency',currency,'exponent',exponent,
      'debitMinor',debit_minor::text,'creditMinor',credit_minor::text) order by line_no)
    into v_debit, v_credit, v_accounts, v_payload from ledger.lines where journal_id = v_id;
  if v_payload is distinct from v_journal.payload or v_accounts < 2
    or v_debit is null or v_debit <> v_credit or v_debit > 9223372036854775807 then
    raise exception 'Incomplete or unbalanced journal' using errcode = '23514';
  end if;
  if v_journal.reverses is not null then
    select jsonb_agg(jsonb_build_object('accountId',account_id::text,'currency',currency,'exponent',exponent,
      'debitMinor',credit_minor::text,'creditMinor',debit_minor::text) order by line_no)
      into v_reverse from ledger.lines where journal_id = v_journal.reverses;
    if v_reverse is distinct from v_payload or v_journal.reverses = v_id then
      raise exception 'Reversal must exactly compensate its source' using errcode = '23514';
    end if;
  end if;
  return null;
end;
$$;
create constraint trigger journals_complete after insert on ledger.journals
deferrable initially deferred for each row execute function ledger.assert_complete();
create constraint trigger lines_complete after insert on ledger.lines
deferrable initially deferred for each row execute function ledger.assert_complete();

create function ledger.post_journal(p_journal jsonb, p_reverses uuid default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_line jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_id uuid;
  v_existing ledger.journals%rowtype;
  v_account uuid;
  v_debit bigint;
  v_credit bigint;
  v_debits numeric := 0;
  v_credits numeric := 0;
  v_exponent integer;
  v_count integer;
begin
  if current_user <> 'postgres' then
    raise exception 'Trusted database operator required' using errcode = '42501';
  end if;
  if p_journal is null or jsonb_typeof(p_journal) is distinct from 'object'
    or jsonb_typeof(p_journal->'effectKey') is distinct from 'string'
    or (p_journal->>'effectKey') !~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{2,199}$'
    or jsonb_typeof(p_journal->'currency') is distinct from 'string'
    or (p_journal->>'currency') !~ '^[A-Z]{3}$'
    or jsonb_typeof(p_journal->'exponent') is distinct from 'number'
    or (p_journal->>'exponent') !~ '^[0-6]$'
    or jsonb_typeof(p_journal->'reason') is distinct from 'string'
    or char_length(btrim(p_journal->>'reason')) not between 3 and 1000
    or jsonb_typeof(p_journal->'lines') is distinct from 'array' then
    raise exception 'Invalid journal envelope' using errcode = '22023';
  end if;
  if jsonb_array_length(p_journal->'lines') not between 2 and 200 then
    raise exception 'Invalid line count' using errcode = '22023';
  end if;
  v_exponent := (p_journal->>'exponent')::integer;
  for v_line in select value from jsonb_array_elements(p_journal->'lines') loop
    if jsonb_typeof(v_line) is distinct from 'object'
      or jsonb_typeof(v_line->'accountId') is distinct from 'string'
      or (v_line->>'accountId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (v_line->'currency') is distinct from (p_journal->'currency')
      or (v_line->'exponent') is distinct from (p_journal->'exponent')
      or jsonb_typeof(v_line->'debitMinor') is distinct from 'string'
      or jsonb_typeof(v_line->'creditMinor') is distinct from 'string'
      or (v_line->>'debitMinor') !~ '^(0|[1-9][0-9]{0,18})$'
      or (v_line->>'creditMinor') !~ '^(0|[1-9][0-9]{0,18})$' then
      raise exception 'Invalid journal line' using errcode = '22023';
    end if;
    if (v_line->>'debitMinor')::numeric > 9223372036854775807
      or (v_line->>'creditMinor')::numeric > 9223372036854775807 then
      raise exception 'Amount overflow' using errcode = '22023';
    end if;
    v_account := (v_line->>'accountId')::uuid;
    v_debit := (v_line->>'debitMinor')::bigint;
    v_credit := (v_line->>'creditMinor')::bigint;
    if (v_debit = 0) = (v_credit = 0) then
      raise exception 'Exactly one positive side required' using errcode = '22023';
    end if;
    v_debits := v_debits + v_debit; v_credits := v_credits + v_credit;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('accountId',v_account::text,
      'currency',p_journal->>'currency','exponent',v_exponent,'debitMinor',v_debit::text,'creditMinor',v_credit::text));
  end loop;
  select count(distinct value->>'accountId') into v_count from jsonb_array_elements(v_lines);
  if v_count < 2 or v_debits <> v_credits or v_debits > 9223372036854775807 then
    raise exception 'Unbalanced journal or amount overflow' using errcode = '22023';
  end if;
  -- Namespace-specific transaction lock; collisions only serialize unrelated requests.
  perform pg_advisory_xact_lock(hashtextextended('ledger.effect:' || (p_journal->>'effectKey'), 0));
  select * into v_existing from ledger.journals where effect_key = p_journal->>'effectKey';
  if found then
    if v_existing.payload is distinct from v_lines or v_existing.currency <> p_journal->>'currency'
      or v_existing.exponent <> v_exponent or v_existing.reason <> btrim(p_journal->>'reason')
      or v_existing.reverses is distinct from p_reverses then
      raise exception 'Effect key already used for different content' using errcode = '22023';
    end if;
    return v_existing.id;
  end if;
  -- Lock accounts in a stable order, independent of input line order.
  perform 1 from ledger.accounts where id in
    (select (value->>'accountId')::uuid from jsonb_array_elements(v_lines)) order by id for update;
  select count(*) into v_count from ledger.accounts where id in
    (select (value->>'accountId')::uuid from jsonb_array_elements(v_lines))
    and currency = p_journal->>'currency' and exponent = v_exponent;
  if v_count <> (select count(distinct value->>'accountId') from jsonb_array_elements(v_lines)) then
    raise exception 'Unknown account or currency/exponent mismatch' using errcode = '22023';
  end if;
  insert into ledger.journals(effect_key,currency,exponent,reason,payload,reverses)
    values(p_journal->>'effectKey',p_journal->>'currency',v_exponent,btrim(p_journal->>'reason'),v_lines,p_reverses)
    returning id into v_id;
  insert into ledger.lines(journal_id,line_no,account_id,currency,exponent,debit_minor,credit_minor)
    select v_id, ordinality::integer, (value->>'accountId')::uuid,p_journal->>'currency',v_exponent,
      (value->>'debitMinor')::bigint,(value->>'creditMinor')::bigint
    from jsonb_array_elements(v_lines) with ordinality;
  -- Validate now as well as at commit, so errors cannot appear as successful RPC results.
  if p_reverses is not null and v_lines is distinct from (
    select jsonb_agg(jsonb_build_object('accountId',account_id::text,'currency',currency,'exponent',exponent,
      'debitMinor',credit_minor::text,'creditMinor',debit_minor::text) order by line_no)
      from ledger.lines where journal_id = p_reverses) then
    raise exception 'Reversal must exactly compensate its source' using errcode = '22023';
  end if;
  return v_id;
end;
$$;
revoke all on all functions in schema ledger from public, anon, authenticated, service_role;
grant usage on schema ledger to postgres;
grant execute on function ledger.post_journal(jsonb,uuid) to postgres;
commit;