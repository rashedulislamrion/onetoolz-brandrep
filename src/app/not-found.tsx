import Link from "next/link";
export default function NotFound() {
  return <section className="section content-page"><span className="eyebrow">404 · PAGE NOT FOUND</span><h1>This path ends here.</h1><p>Let’s get you back to the partner program.</p><Link href="/" className="button">Back to home</Link></section>;
}