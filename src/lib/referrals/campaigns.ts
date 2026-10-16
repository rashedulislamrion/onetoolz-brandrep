export const STORE_ORIGIN = "https://cu.onetoolz.com";

export function validReferralCode(value: string) {
  return value.length === 32 && /^[a-f0-9]{32}$/.test(value);
}

// Only paths on the fixed store are accepted. Queries/fragments are deliberately
// excluded: a campaign cannot smuggle a checkout redirect or referral override.
export function validDestinationPath(value: string) {
  return value.length <= 500 && !/[\r\n]/.test(value) && /^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]*$/.test(value);
}

export function parseCampaign(form: FormData) {
  const name = form.get("name");
  const destination = form.get("destination");
  const requestId = form.get("requestId");
  if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 80 ||
    /[\u0000-\u001f\u007f]/.test(name) || typeof destination !== "string" || !validDestinationPath(destination) ||
    typeof requestId !== "string" || requestId.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) return null;
  return { name: name.trim(), destination, requestId: requestId.toLowerCase() };
}

export function storeDestination(path: string) {
  if (!validDestinationPath(path)) return null;
  return new URL(path, STORE_ORIGIN).href;
}

export function referralLink(origin: string, code: string) {
  if (!validReferralCode(code)) return null;
  try {
    const url = new URL(origin);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      !(url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) return null;
    return new URL(`/r/${code}`, url).href;
  } catch { return null; }
}