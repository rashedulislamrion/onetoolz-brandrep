import { boundedBody } from "./webhook";

export type DiscoveryClaim = { lease: string; page: number; before: string };
export function parseDiscoveryClaim(value: unknown): DiscoveryClaim {
  const claim = value as DiscoveryClaim | null;
  if (!claim || typeof claim.lease !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(claim.lease) ||
    !Number.isSafeInteger(claim.page) || claim.page < 1 || claim.page > 1000000 ||
    typeof claim.before !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(claim.before) ||
    !Number.isFinite(Date.parse(claim.before))) throw new Error("Invalid discovery claim");
  return claim;
}

export async function fetchDiscoveryPage(claim: DiscoveryClaim, credentials: { key: string; secret: string }, transport: typeof fetch = fetch) {
  const url = new URL("https://cu.onetoolz.com/wp-json/wc/v3/orders");
  url.search = new URLSearchParams({ page: String(claim.page), per_page: "50", order: "asc", orderby: "id",
    before: claim.before, dates_are_gmt: "true", status: "any", _fields: "id" }).toString();
  const response = await transport(url, { headers: { Authorization: `Basic ${Buffer.from(`${credentials.key}:${credentials.secret}`).toString("base64")}` },
    redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error("Discovery unavailable"); }
  const raw = await boundedBody(new Request("https://local.invalid", { method: "POST", body: response.body, duplex: "half" } as RequestInit));
  const data: unknown = JSON.parse(raw.toString("utf8"));
  if (!Array.isArray(data) || data.length > 50) throw new Error("Invalid discovery page");
  const ids = data.map(row => {
    if (!row || typeof row !== "object" || !Number.isSafeInteger(row.id) || row.id < 1) throw new Error("Invalid discovery ID");
    return String(row.id);
  });
  if (ids.some((id, index) => index > 0 && BigInt(id) <= BigInt(ids[index - 1]))) throw new Error("Unordered discovery page");
  // Require pagination metadata; never interpret a provider error/missing header as completion.
  const pages = response.headers.get("x-wp-totalpages");
  if (!pages || !/^(0|[1-9]\d{0,6})$/.test(pages) || Number(pages) > 1000000 ||
    (Number(pages) === 0 && (claim.page !== 1 || ids.length !== 0)) ||
    (Number(pages) > 0 && (claim.page > Number(pages) || ids.length === 0)) ||
    (claim.page < Number(pages) && ids.length !== 50)) throw new Error("Invalid discovery pagination");
  return { ids, complete: claim.page >= Number(pages) };
}

export async function discoverOne(dependencies: {
  claim: () => Promise<unknown>;
  fetchPage: (claim: DiscoveryClaim) => Promise<{ ids: string[]; complete: boolean }>;
  finish: (claim: DiscoveryClaim, page: { ids: string[]; complete: boolean }) => Promise<number>;
}) {
  const value = await dependencies.claim();
  if (value === null) return { scanned: 0, queued: 0 };
  const claim = parseDiscoveryClaim(value);
  const page = await dependencies.fetchPage(claim);
  const queued = await dependencies.finish(claim, page);
  if (!Number.isInteger(queued) || queued < 0 || queued > page.ids.length) throw new Error("Invalid discovery result");
  return { scanned: page.ids.length, queued };
}