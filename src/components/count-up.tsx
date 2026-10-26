"use client";

import { useEffect, useRef, useState } from "react";

// Animates an integer from 0 to `value` on first view. Honors
// prefers-reduced-motion by rendering the final value immediately.
export function CountUp({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const done = requestAnimationFrame(() => setDisplay(value));
      return () => cancelAnimationFrame(done);
    }
    let frame = 0;
    const start = performance.now();
    const duration = 750;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(eased * value));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <span ref={ref}>{display.toLocaleString("en-US")}</span>;
}
