import type { Metadata } from "next";
import Link from "next/link";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { SiteHeader } from "@/components/site-header";
import { SiteChrome } from "@/components/site-chrome";
import "./globals.css";
import "./revenue.css";
import "./app.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const space = Space_Grotesk({ subsets: ["latin"], variable: "--font-space", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "OneToolz BrandRep — The Revenue Engine", template: "%s | OneToolz BrandRep" },
  description: "The OneToolz affiliate program is live. Apply, promote powerful tools, track qualified referrals and earn eligible commissions. Approval required.",
  robots: { index: false, follow: false },
};

// Nonce-based CSP and authentication pages must never be statically shared.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const footer = <footer className="site-footer"><span>OneToolz BrandRep <span className="muted">— The Revenue Engine by OneToolz.</span></span><nav aria-label="Footer"><Link href="/program">Program details</Link><span className="badge">● Live</span></nav></footer>;
  return <html lang="en" className={`${inter.variable} ${space.variable} ${mono.variable}`}><body><a href="#main-content" className="skip-link">Skip to content</a><SiteChrome header={<SiteHeader />} footer={footer}>{children}</SiteChrome></body></html>;
}
