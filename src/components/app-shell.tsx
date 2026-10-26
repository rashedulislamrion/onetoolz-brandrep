import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { signOut } from "@/app/auth/actions";

// Shared frame for the signed-in workspaces (partner + admin). The marketing
// site chrome is suppressed on these routes by SiteChrome; this shell is the
// entire frame: sidebar navigation, topbar, and the page content.
export function AppShell({ area, email, children }: { area: "partner" | "admin"; email: string; children: React.ReactNode }) {
  const areaLabel = area === "admin" ? "Administration" : "Partner workspace";
  return <div className="app-shell">
    <aside className="app-sidebar">
      <Link href={area === "admin" ? "/admin" : "/dashboard"} className="brand app-brand" aria-label="OneToolz BrandRep workspace home">
        <span className="brand-icon" aria-hidden="true">↗</span>
        <span>OneToolz<span className="brand-sub">BRANDREP · {area === "admin" ? "ADMIN" : "PARTNERS"}</span></span>
      </Link>
      <AppNav area={area} />
      <div className="app-user">
        <span className="app-user-avatar" aria-hidden="true">{email.slice(0, 1).toUpperCase()}</span>
        <span className="app-user-meta"><strong>{areaLabel}</strong><span>{email}</span></span>
        <form action={signOut}><button type="submit" className="app-signout">Sign out</button></form>
      </div>
    </aside>
    <div className="app-column">
      <header className="app-topbar">
        <span className="app-topbar-area">{areaLabel}</span>
        <span className="live-chip"><span className="live-dot" aria-hidden="true" /> Program live</span>
      </header>
      <main id="main-content" className="app-content">{children}</main>
    </div>
  </div>;
}
