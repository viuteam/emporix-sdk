---
"@viu/emporix-sdk-next": minor
---

feat(repo): add a generic error-reporting seam

`setEmporixErrorReporter(fn)` registers one process-wide reporter, from Next's
`instrumentation.ts`. The package ships the interface and **no implementation** —
the same split as `EmporixSessionStore` — so its zero-runtime-dependency property
is unchanged and no vendor is chosen for you.

`instrumentation.ts` rather than a `getEmporixClient` option because that factory
is memoized on a string key: a function cannot be keyed, so a per-client reporter
would mean the first caller silently wins for the whole process.

Ten failure points that degraded silently now report: both session-store reads, a
guest cart lost during login, a flush lost while unwinding a Server Action error, a
throwing webhook `onEvent`, plus cookie decryption, anonymous-cookie parsing,
upstream logout and two webhook body-parse sites at `warning`.

**No behaviour changes.** Every one of those sites returns exactly what it
returned before; reporting is additive. Five further `catch` sites stay
deliberately silent — including the per-key retry during cookie-secret rotation
and the allowlist check on attacker-controlled URLs — and a regression test
asserts they do.

Events carry a stable `code` to group on (never a message: the SDK interpolates
tenant and path into those), a `degradedTo` describing the consequence, and the
original `cause`. `context` goes through the SDK's `redact()`; `cause` does not,
because a scrubbed stack trace is useless — scrubbing it is the consumer's call.
A reporter that throws is contained.
