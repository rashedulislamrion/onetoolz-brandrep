import Link from "next/link";

export function SiteHeader() {
  return <header className="site-header">
    <Link href="/" className="brand" aria-label="OneToolz Affiliates home"><span className="brand-icon" aria-hidden="true">↗</span><span>OneToolz<span className="brand-sub">BRANDREP · AFFILIATES</span></span></Link>
    <nav aria-label="Main navigation"><a href="https://cu.onetoolz.com" className="nav-detail">Visit store ↗</a><Link href="/how-it-works" className="nav-detail">How it works</Link><Link href="/program" className="nav-detail">The program</Link><Link href="/login">Sign in</Link><Link href="/register" className="button small">Join the opportunity ↗</Link></nav>
  </header>;
}