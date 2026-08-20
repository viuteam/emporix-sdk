---
"@viu/emporix-sdk-next": patch
---

docs: correct five stale claims in the next README and split off the rationale

The README carried five inaccuracies, found by checking every claim against the
code:

- The deprecation note for `sessionCookieJar` / `SessionCookieJar` announced
  removal in **0.6.0**. The package is at 0.8.x and both aliases are still
  exported. Restated: still exported, still deprecated, removal in **1.0.0**.
- «All three are peer dependencies» — there are two, `@viu/emporix-sdk` and
  `next`. The third package in the install line is this one.
- «about 25 Server Actions … a narrower B2C flow lands nearer 19» for
  `examples/next-server-first`. It has **16**, which also made the sentence
  self-contradictory. Re-measured and moved to `docs/next.md`.
- «41 hooks» for `examples/storefront-demo` matched no measurement (50 or 54
  depending on how you count) and the claim never said what it counted. Dropped.
- `emporixRefresh` is exported from `/session` but appeared nowhere in the README,
  under a heading that reads «Login, logout, refresh». Now documented.

The README also did three jobs at once — reference, architecture rationale, and a
set of post-mortems — at 902 lines, 4.5× the core SDK's README. The reasoning now
lives in `docs/next.md`: the session flow and login-ordering diagrams, the
dynamic-rendering cost of one `cookies()` call, the dead-cart-id recovery pattern,
the prefetch that rewrote the visitor's language, and the webhook signature
caveat. The README keeps every API, table and code example, and links to the
reasoning where it matters.

No code change: every exported symbol, path and default is unchanged. Published as
a patch because npmjs.com renders the README of the published version, so a
docs-only fix that is never released never reaches the page.
