import { readFile } from "node:fs/promises";

// Offline SQL emitter. Execute only against the confirmed nonproduction project.
// A dedicated schema makes committed fixtures visible to independent sessions.
const schema = "woo_acceptance_20261015";
const bodies = [];
for (const file of ["20261015150000_woo_ingestion.sql", "20261015170000_woo_discovery.sql"]) {
  const source = await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");
  const match = source.replaceAll("\r\n", "\n").match(/^--[^\n]*\nbegin;\n([\s\S]*)\ncommit;\s*$/);
  if (!match) throw new Error(`Unexpected migration wrapper: ${file}`);
  bodies.push(match[1].replace(/\bwoo\b/g, schema).replace(/public\.(?=(?:ingest_woo_notification|claim_woo_refresh|finish_woo_refresh|requeue_woo_orders|claim_woo_discovery|finish_woo_discovery)\b)/g, `${schema}.`));
}
console.log(`begin;
set local statement_timeout='20s';
set local lock_timeout='5s';
do $$ begin
 if to_regnamespace('woo') is not null or to_regnamespace('${schema}') is not null then raise exception 'Requires absent production and acceptance schemas'; end if;
end $$;
${bodies.join("\n")}
-- No application role may use the fixture schema or execute its functions.
revoke all on all functions in schema ${schema} from public,anon,authenticated,service_role;
create table ${schema}.evidence(case_name text primary key,pid integer not null default pg_backend_pid(),detail jsonb not null);
create function ${schema}.wait_for_waiter() returns void language plpgsql set search_path='' as $$
declare deadline timestamptz:=clock_timestamp()+interval '18 seconds';
begin
 loop
  if exists(select 1 from pg_stat_activity a where a.pid<>pg_backend_pid() and pg_backend_pid()=any(pg_blocking_pids(a.pid))) then return; end if;
  if clock_timestamp()>deadline then raise exception 'No independent blocked session observed'; end if;
  perform pg_sleep(0.05);
 end loop;
end $$;
revoke all on function ${schema}.wait_for_waiter() from public,anon,authenticated,service_role;
commit;
select to_regnamespace('${schema}') is not null as fixture_created;
`);