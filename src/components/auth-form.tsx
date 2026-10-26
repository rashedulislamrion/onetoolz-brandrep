import Link from "next/link";
import { getAuthConfiguration } from "@/lib/config";
import { register, requestPasswordReset, signIn, updatePassword } from "@/app/auth/actions";
import { SubmitButton } from "@/components/submit-button";

const notices: Record<string, string> = {
  setup: "Account access is not configured yet. No information has been submitted.",
  session: "Please sign in to continue.",
  invalid: "Check your details and try again. Passwords must contain 12–128 characters.",
  credentials: "We could not sign you in with those details.",
  unavailable: "That request could not be completed. Please try again later.",
  verify: "If registration is available for this email, check your inbox to confirm your account.",
  reset: "If an account exists for that email, password reset instructions will arrive shortly.",
  signedout: "You have been signed out.",
  callback: "This confirmation link could not be verified. It may have expired; request a new one.",
};

const modes = {
  login: { title: "Welcome back.", description: "Your partnership, all in one place.", submit: "Sign in", action: signIn },
  register: { title: "Your next chapter starts here.", description: "Create your OneToolz partner account. Then tell us about your audience and apply to join.", submit: "Create account", action: register },
  forgot: { title: "Let’s get you back in.", description: "We’ll send a secure password reset link to your email.", submit: "Send reset link", action: requestPasswordReset },
  reset: { title: "A fresh start.", description: "Choose a strong, unique password for your account.", submit: "Update password", action: updatePassword },
};

export function AuthForm({ mode, notice }: { mode: keyof typeof modes; notice?: string }) {
  const config = getAuthConfiguration(process.env);
  const content = modes[mode];
  return <div className="auth-layout">
    <aside className="auth-aside"><span className="eyebrow">ONETOOLZ BRANDREP</span><h2>You know your people.<br />Make that connection count.</h2><p>Discover OneToolz. Bring your recommendations to your community. Build toward an earning opportunity that fits your voice.</p><a href="https://cu.onetoolz.com" className="text-link">Explore our main store ↗</a><div className="aside-note"><span aria-hidden="true">✦</span> Live program · Approval required · No guaranteed income</div></aside>
    <section className="auth-card" aria-labelledby="auth-title"><span className="eyebrow">YOUR PARTNER ACCOUNT</span><h1 id="auth-title">{content.title}</h1><p className="muted">{content.description}</p>
      {!config.ready && <div className="notice" role="status"><strong>Setup in progress</strong><p>{config.reason} Forms are disabled until a dedicated authentication environment is connected.</p></div>}
      {notice && notices[notice] && <p className="notice" role="status">{notices[notice]}</p>}
      <form action={content.action}>
        {mode !== "reset" && <label>Email address<input type="email" name="email" autoComplete="email" maxLength={254} placeholder="you@example.com" required disabled={!config.ready} /></label>}
        {mode !== "forgot" && <label>Password<input type="password" name="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={12} maxLength={128} required disabled={!config.ready} aria-describedby="password-help" /><span id="password-help" className="field-help">Use 12–128 characters. Never reuse a store password.</span></label>}
        {mode === "login" && <Link href="/forgot-password" className="text-link form-link">Forgot password?</Link>}
        <SubmitButton disabled={!config.ready}>{content.submit} <span aria-hidden="true">↗</span></SubmitButton>
      </form>
      {mode === "login" ? <p className="auth-switch">New to the program? <Link href="/register" className="text-link">Create an account</Link></p> : <p className="auth-switch">Already have an account? <Link href="/login" className="text-link">Sign in</Link></p>}
      {mode === "register" && <p className="field-help">Registration does not approve an affiliate application or activate earnings. Program terms must be finalized before public launch.</p>}
    </section>
  </div>;
}