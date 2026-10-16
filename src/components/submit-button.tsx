"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({ children, disabled = false }: { children: React.ReactNode; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return <button className="button full" type="submit" disabled={disabled || pending} aria-disabled={disabled || pending}>{pending ? "Please wait…" : children}</button>;
}