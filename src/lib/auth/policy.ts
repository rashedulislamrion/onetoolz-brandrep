export type AccessInput = { roles: readonly string[]; affiliateStatus: string | null; aal: string | null };

export function mayAccessAffiliate(input: AccessInput): boolean {
  return input.roles.includes("affiliate") && input.affiliateStatus === "approved";
}

export function mayAccessAdmin(input: AccessInput): boolean {
  return input.roles.includes("admin") && input.aal === "aal2";
}

export function isSameOrigin(actual: string | null, expected: string): boolean {
  if (!actual) return false;
  try { return new URL(actual).origin === expected && actual === expected; } catch { return false; }
}

export function safeReturnPath(value: string | null): string {
  return value === "/reset-password" ? value : "/application/status";
}

export function validateCredentials(form: FormData): { email: string; password: string } | null {
  const email = form.get("email");
  const password = form.get("password");
  if (typeof email !== "string" || typeof password !== "string") return null;
  const normalized = email.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || password.length < 12 || password.length > 128) return null;
  return { email: normalized, password };
}