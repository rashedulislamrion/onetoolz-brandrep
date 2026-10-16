import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("combined Woo rollback rehearsal", () => {
  it("composes the exact source bodies without committing migrations or ending early", () => {
    const child = spawnSync(process.execPath, [resolve("scripts/woo-rehearsal.mjs")], { encoding: "utf8", timeout: 10000 });
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(0);
    const sql = child.stdout;
    expect(sql).not.toMatch(/^commit;/m);
    expect(sql.match(/^begin;/gm)).toHaveLength(1);
    expect(sql.match(/^rollback;/gm)).toHaveLength(1);
    expect(sql.trim()).toMatch(/rollback;\s*select to_regnamespace\('woo'\) is null as rollback_verified;$/);
    expect(sql).toContain("Rehearsal requires absent woo schema");
    for (const file of [
      "supabase/migrations/20261016080655_woo_ingestion.sql",
      "supabase/migrations/20261016080727_woo_discovery.sql",
      "supabase/tests/woo_ingestion.sql",
      "supabase/tests/woo_discovery.sql",
    ]) {
      const source = readFileSync(resolve(file), "utf8").replaceAll("\r\n", "\n");
      const body = source.slice(source.indexOf("begin;\n") + 7).split(/^(?:commit|rollback);/m)[0];
      expect(sql).toContain(body);
    }
    expect(sql.indexOf("create schema woo;")).toBeLessThan(sql.indexOf("create table woo.discovery"));
    expect(sql.indexOf("Requires empty isolated intake")).toBeLessThan(sql.indexOf("Fixture collision"));
  });
});