"use client";

import { useState, useTransition } from "react";
import { enrollAuthenticator, verifyAuthenticator, type EnrollmentState } from "@/app/account/security/actions";
import { SubmitButton } from "@/components/submit-button";

export function MfaEnrollment() {
  const [state, setState] = useState<EnrollmentState>({});
  const [pending, startTransition] = useTransition();
  return <section aria-label="Authenticator enrollment">
    <p>Add an authenticator using a manual setup key. Keep the key private; do not send it to support or paste it into chat.</p>
    {!state.secret && <button className="button" disabled={pending} onClick={() => startTransition(async () => {
      try { setState(await enrollAuthenticator()); } catch { setState({ error: "Setup could not be completed. Reload the page and try again." }); }
    })}>{pending ? "Preparing…" : "Set up authenticator"}</button>}
    {state.error && <p className="notice" role="alert">{state.error}</p>}
    {state.secret && state.factorId && <div>
      <p>In your authenticator, choose a time-based account and enter this key:</p><code className="mfa-key">{state.secret}</code>
      <p className="field-help">This key is shown only during setup. If you leave before verifying, start setup again.</p>
      <form action={verifyAuthenticator}><input type="hidden" name="factorId" value={state.factorId} /><label>Six-digit code<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required /></label><SubmitButton>Verify authenticator</SubmitButton></form>
    </div>}
  </section>;
}