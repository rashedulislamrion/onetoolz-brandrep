import { describe, expect, it, vi } from "vitest";
import { discoverOne, fetchDiscoveryPage, parseDiscoveryClaim } from "../../src/lib/woocommerce/discovery";

const claim = { lease: "10000000-0000-4000-8000-000000000001", page: 1, before: "2026-10-15T00:00:00Z" };
const credentials = { key: "synthetic", secret: "synthetic" };
const rows = Array.from({ length: 50 }, (_, i) => ({ id: i + 1 }));
function transport(body: unknown, pages: string | null = "1", status = 200) {
  return vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), {
    status, headers: pages === null ? {} : { "x-wp-totalpages": pages },
  }));
}
describe("bounded Woo discovery", () => {
  it.each([null, {}, { ...claim, page: 0 }, { ...claim, page: 1000001 }, { ...claim, lease: "-".repeat(36) }, { ...claim, before: "bad" }])("rejects invalid claim %#", value => {
    expect(() => parseDiscoveryClaim(value)).toThrow();
  });
  it("uses fixed origin, stable cutoff, minimal fields and redirect rejection", async () => {
    const fetcher = transport(rows, "2");
    const result = await fetchDiscoveryPage(claim, credentials, fetcher);
    expect(result).toEqual({ ids: rows.map(row => String(row.id)), complete: false });
    const [url, options] = fetcher.mock.calls[0];
    expect((url as URL).origin).toBe("https://cu.onetoolz.com");
    expect((url as URL).searchParams.get("before")).toBe(claim.before);
    expect((url as URL).searchParams.get("_fields")).toBe("id");
    expect(options).toMatchObject({ redirect: "error", cache: "no-store" });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });
  it("recognizes final and empty scans", async () => {
    expect(await fetchDiscoveryPage(claim, credentials, transport([{ id: 5 }]))).toEqual({ ids: ["5"], complete: true });
    expect(await fetchDiscoveryPage(claim, credentials, transport([], "0"))).toEqual({ ids: [], complete: true });
  });
  it.each([{}, [{ id: 0 }], [{ id: "1" }], [{ id: 9007199254740992 }], [{ id: 2 }, { id: 1 }], [{ id: 1 }, { id: 1 }], [...rows, { id: 51 }]])("rejects malformed page %#", async body => {
    await expect(fetchDiscoveryPage(claim, credentials, transport(body))).rejects.toThrow();
  });
  it.each([null, "-1", "x", "1000001", "0", "2"])("rejects inconsistent metadata %s", async pages => {
    await expect(fetchDiscoveryPage(claim, credentials, transport([{ id: 1 }], pages))).rejects.toThrow();
  });
  it("does not accept provider failure as an empty scan", async () => {
    await expect(fetchDiscoveryPage(claim, credentials, transport([], "0", 401))).rejects.toThrow("Discovery unavailable");
  });
  it("rejects oversized bodies", async () => {
    await expect(fetchDiscoveryPage(claim, credentials, transport("x".repeat(1024 * 1024)))).rejects.toThrow();
  });
  it("does no work without a claim", async () => {
    const fetchPage = vi.fn(); const finish = vi.fn();
    expect(await discoverOne({ claim: async () => null, fetchPage, finish })).toEqual({ scanned: 0, queued: 0 });
    expect(fetchPage).not.toHaveBeenCalled(); expect(finish).not.toHaveBeenCalled();
  });
  it("leaves checkpoint untouched on fetch failure", async () => {
    const finish = vi.fn();
    await expect(discoverOne({ claim: async () => claim, fetchPage: async () => { throw new Error("network"); }, finish })).rejects.toThrow();
    expect(finish).not.toHaveBeenCalled();
  });
  it("reports scanned IDs separately from newly queued IDs", async () => {
    expect(await discoverOne({ claim: async () => claim, fetchPage: async () => ({ ids: ["1", "2"], complete: true }), finish: async () => 1 })).toEqual({ scanned: 2, queued: 1 });
  });
  it("does not report success when persistence fails", async () => {
    await expect(discoverOne({ claim: async () => claim, fetchPage: async () => ({ ids: ["1"], complete: true }), finish: async () => { throw new Error("stale"); } })).rejects.toThrow();
  });
});