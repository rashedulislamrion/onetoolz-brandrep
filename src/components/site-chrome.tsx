"use client";

import { usePathname } from "next/navigation";

// The marketing header/footer frame the public site. Signed-in workspace
// routes (/dashboard, /admin) render their own AppShell frame instead, so
// the marketing chrome steps aside there.
export function SiteChrome({ header, footer, children }: { header: React.ReactNode; footer: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const workspace = pathname.startsWith("/dashboard") || pathname.startsWith("/admin");
  if (workspace) return <>{children}</>;
  return <>{header}<main id="main-content">{children}</main>{footer}</>;
}
