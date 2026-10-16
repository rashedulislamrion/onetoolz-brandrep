# Foundation threat model

Status: initial engineering review; not an independent security assessment.

| Threat | Foundation control | Remaining verification |
| --- | --- | --- |
| User assigns own admin role | No role mutation path; role table read, never user metadata | Real schema grants/RLS and provisioning tests |
| Unauthenticated dashboard request | Server `getUser()` and fail-closed checks | Real expired/revoked session tests |
| Admin account without MFA | AAL2 required | Enrollment/challenge UX and provider tests |
| Cross-origin account action | Framework server action checks plus exact configured Origin | Browser attack suite on staging |
| Callback open redirect | Exact allowed destination list and configured origin | Real PKCE flows and expired codes |
| Secrets leak to browser | No privileged key used, server-only data access, secret heuristic | Dedicated scanner and deployment review |
| Private cached response | Dynamic rendering and private/no-store response headers | Hosted cache behavior checks |
| XSS/framing | Nonce-based script CSP, frame denial, React escaping | Independent review and full browser accessibility/security checks |
| Production data in previews | Auth environment gate rejects preview+production | Verify actual project URLs and provider permissions |
| Signup/reset abuse | Auth disabled by default; provider rate-limit review required | Durable app-level limiter/CAPTCHA before public signup |
| Insecure dependency | Exact pins and audit visibility | Resolve/review development glob-chain advisory before release |

No financial or store integration endpoints exist. Introducing them requires a separate threat-model update covering signatures, replay, idempotency, fraud, and transactional finance.