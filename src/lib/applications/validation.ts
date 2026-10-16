export type ApplicationInput = { displayName: string; promotionUrl: string; promotionPlan: string };

export function validateApplication(form: FormData): ApplicationInput | null {
  const name = form.get("displayName");
  const url = form.get("promotionUrl");
  const plan = form.get("promotionPlan");
  if (typeof name !== "string" || typeof url !== "string" || typeof plan !== "string") return null;
  const displayName = name.trim();
  const promotionPlan = plan.trim();
  if (displayName.length < 2 || displayName.length > 100 || promotionPlan.length < 30 || promotionPlan.length > 2000 || url.length > 2048) return null;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || !parsed.hostname.includes(".") || parsed.hostname === "localhost") return null;
    return { displayName, promotionUrl: parsed.href, promotionPlan };
  } catch { return null; }
}