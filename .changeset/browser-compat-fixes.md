---
"@viu/emporix-sdk": minor
---

Fix two defects found by live verification of the example apps:

- **Browser compatibility:** the SDK read `process.env` unconditionally
  (logger level resolution + console-logger `pretty` default), throwing
  `ReferenceError: process is not defined` in browsers/edge runtimes. All env
  reads now go through a guarded `readEnv()`. The SDK works in the browser
  without `logger: false`.
- **`credentials.backend` is now optional.** Storefront/SPA apps use only
  `credentials.storefront` (anonymous) plus caller-supplied customer tokens and
  must never ship a backend secret. `validateConfig` no longer requires
  `backend`; a missing backend is enforced lazily (clear `EmporixAuthError`)
  only when a `service` AuthContext is actually used.
