"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { href: string; label: string; icon: string; external?: boolean };

// Stroke icon paths (24x24, drawn with stroke="currentColor", fill none).
const ICONS: Record<string, string> = {
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  link: "M10 14a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.2 1.1M14 10a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1.2-1.1",
  wallet: "M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v2M3 7v10a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2zM16.5 13.5h.01",
  inbox: "M4 13l2.2-7.2A2 2 0 0 1 8.1 4.5h7.8a2 2 0 0 1 1.9 1.3L20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5zM4 13h4l1.5 2.5h5L16 13h4",
  scale: "M12 3v18M7 21h10M12 6l-5 0m5 0l5 0M7 6l-2.5 6a3.5 3.5 0 0 0 5 0L7 6zM17 6l-2.5 6a3.5 3.5 0 0 0 5 0L17 6z",
  sliders: "M5 7h9M18 7h1M5 17h3M12 17h7M14 4.5v5M8 14.5v5",
  shield: "M12 3l7 2.8v5.4c0 4.6-3 7.6-7 9.3-4-1.7-7-4.7-7-9.3V5.8L12 3zM9 11.6l2.2 2.2L15.4 9.6",
  store: "M4 10.5L5.6 4.5h12.8L20 10.5M4 10.5h16M4 10.5V19a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8.5M9.5 20v-5.5h5V20",
  book: "M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 18V4.5zM5 18a1.5 1.5 0 0 0 1.5 1.5H19V21H6.5A1.5 1.5 0 0 1 5 19.5V18z",
};

const PARTNER_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: "grid" },
  { href: "/dashboard/referrals", label: "Referral campaigns", icon: "link" },
  { href: "/dashboard/payouts", label: "Payouts", icon: "wallet" },
  { href: "/account/security", label: "Account & security", icon: "shield" },
  { href: "/program", label: "Program details", icon: "book" },
];

const ADMIN_ITEMS: NavItem[] = [
  { href: "/admin", label: "Overview", icon: "grid" },
  { href: "/admin/applications", label: "Applications", icon: "inbox" },
  { href: "/admin/payouts", label: "Payout queue", icon: "wallet" },
  { href: "/admin/reconciliation", label: "Reconciliation", icon: "scale" },
  { href: "/admin/settings", label: "Program settings", icon: "sliders" },
  { href: "/account/security", label: "Account & security", icon: "shield" },
];

export function AppNav({ area }: { area: "partner" | "admin" }) {
  const pathname = usePathname() ?? "";
  const items = area === "admin" ? ADMIN_ITEMS : PARTNER_ITEMS;
  return <nav className="app-nav" aria-label={area === "admin" ? "Admin navigation" : "Partner navigation"}>
    {items.map(item => {
      const active = pathname === item.href || (item.href !== "/dashboard" && item.href !== "/admin" && pathname.startsWith(item.href));
      return <Link key={item.href} href={item.href} className={active ? "app-nav-item active" : "app-nav-item"} aria-current={active ? "page" : undefined}>
        <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[item.icon]} /></svg>
        <span>{item.label}</span>
      </Link>;
    })}
    <a href="https://cu.onetoolz.com" className="app-nav-item" target="_blank" rel="noreferrer">
      <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS.store} /></svg>
      <span>Visit the store ↗</span>
    </a>
  </nav>;
}
