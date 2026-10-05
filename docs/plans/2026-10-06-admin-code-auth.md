# Admin Code Authentication Implementation Plan

**Goal:** Require the fixed access code on the server and return authenticated visitors to their original page.

**Architecture:** Replace anonymous session creation and default-password login with code verification. Reuse the existing session manager, but keep random credentials in HttpOnly cookies with a seven-day absolute expiry. Protect APIs, configuration resources and Socket.IO through the same session validation.

**Tech Stack:** Express 4, Node crypto, Socket.IO, Vue 3, Vue Router, Pinia, Axios, node:test.

## Implementation

1. Add expiring, revocable cookie sessions and disconnect expired realtime clients.
2. Replace authentication routes and limit failed verification attempts. Allow cross-origin requests while keeping session and account permission checks. Keep only health, branding and temporary token-protected certificate downloads public.
3. Add a code verification page and server-validated navigation guards. Preserve local paths, queries and fragments; reject external redirect destinations. Remove frontend credential storage and adapt realtime and scan-login requests.
4. Add a logout control, avoid protected requests before verification, and update Docker health checks.
5. Test with isolated local fixtures, type-check and build the frontend, and document deployment behavior. Do not connect to game accounts or open a browser for acceptance.

## Verification

- Wrong/missing codes and old anonymous/default-password paths cannot create sessions.
- Cookie flags, expiration boundaries, revocation and realtime disconnects are covered.
- Protected endpoints cannot be reached by anonymous requests or fake credentials.
- Login throttling cannot be bypassed with forwarded IP headers.
- Cross-origin login, authenticated mutations and Socket.IO connections are supported; missing or forged sessions still cannot access protected endpoints.
- Original internal destinations are restored, external and malformed redirects are rejected.
- Frontend type checking and production build pass; visual acceptance remains manual.
