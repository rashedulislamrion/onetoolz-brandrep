"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <section className="section content-page"><h1>Something didn’t load.</h1><p>No success should be assumed. Please try loading the page again.</p><button className="button" onClick={reset}>Try again</button></section>;
}