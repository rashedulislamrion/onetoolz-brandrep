import { readFile } from "node:fs/promises";

// Emit SQL only; never connect, apply a migration, or load credentials.
// Exact wrapper removal deliberately fails closed if a source wrapper changes.
const sources = [
  ["supabase/migrations/20261016080655_woo_ingestion.sql", "commit;"],
  ["supabase/migrations/20261016080727_woo_discovery.sql", "commit;"],
  ["supabase/tests/woo_ingestion.sql", "rollback;"],
  ["supabase/tests/woo_discovery.sql", "rollback;"],
];
const chunks = [];
for (const [file, end] of sources) {
  const lines = (await readFile(new URL(`../${file}`, import.meta.url), "utf8")).split(/\r?\n/);
  const first = lines.findIndex(line => line.trim() && !line.trim().startsWith("--"));
  const ends = lines.flatMap((line, index) => line.trim() === end ? [index] : []);
  if (lines[first]?.trim() !== "begin;" || ends.length !== 1 || ends[0] <= first) throw new Error(`Unexpected transaction wrapper: ${file}`);
  const tail = lines.slice(ends[0] + 1).join("\n").trim();
  if (tail && !/^select '[^']+' as \w+;$/.test(tail)) throw new Error(`Unexpected trailing SQL: ${file}`);
  chunks.push(`-- Source: ${file}\n${lines.slice(first + 1, ends[0]).join("\n")}`);
}
console.log(`begin;
set local statement_timeout='20s';
set local lock_timeout='5s';
do $$ begin
 if to_regnamespace('woo') is not null then raise exception 'Rehearsal requires absent woo schema'; end if;
 if to_regprocedure('public.prevent_application_event_change()') is null then raise exception 'Missing identity prerequisite'; end if;
end $$;
${chunks.join("\n")}
rollback;
select to_regnamespace('woo') is null as rollback_verified;
`);