import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "OneToolz BrandRep — Your next earning opportunity", template: "%s | OneToolz BrandRep" },
  description: "Explore the OneToolz affiliate opportunity. Discover our store, bring your recommendations, and start your partner journey. Pre-launch; approval required.",
  robots: { index: false, follow: false },
};

// Nonce-based CSP and authentication pages must never be statically shared.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><a href="#main-content" className="skip-link">Skip to content</a><SiteHeader /><main id="main-content">{children}</main><footer className="site-footer"><span>OneToolz Affiliates <span className="muted">— Built for better partnerships.</span></span><nav aria-label="Footer"><Link href="/program">Program details</Link><span className="badge">Pre-launch</span></nav></footer></body></html>;
}