# Prefetch guard for the Emporix proxy — DISCARDED

**Status:** discarded 2026-08-05, do not implement
**Would have touched:** `packages/next/src/token-proxy.ts`, `packages/next/src/proxy.ts`

This was a full implementation plan. It was written, executed, and rolled back the
same day because its central assumption is false. What survives is the measurement —
kept so nobody walks this path twice.

## What it wanted to do

Stop `emporixTokenProxy` rotating the customer token, and `emporixSiteProxy` writing
site and language cookies, on a speculative `<Link>` prefetch. Two real costs
motivated it: an Emporix auth call for a page nobody opens, and `emporixRefresh`
having no de-duplication, so a burst of parallel prefetches redeems the same refresh
token several times over.

## Why it cannot work

**A prefetch is not detectable in Next middleware.** Measured against a real Chrome
`<Link prefetch>` on Next 16.2.12, with a probe that echoed the incoming headers back
as a response header:

| sent by the browser                    | seen in middleware |
| -------------------------------------- | ------------------ |
| `next-router-prefetch: 1`              | **`null`**         |
| `rsc: 1`                               | **`null`**         |
| `next-router-segment-prefetch: /_tree` | **`null`**         |
| `?_rsc=…` in the URL                   | **not visible**    |
| `sec-purpose`                          | not sent at all    |

Next strips its own router signals before middleware runs — while still listing
`next-router-prefetch` in the response `Vary`, so it uses them internally. A prefetch
is therefore indistinguishable in middleware from a genuine client-side navigation;
both arrive as `sec-fetch-mode: cors`.

`Sec-Purpose` does survive, but Chrome does not set it for a `fetch()`-based Next
prefetch — it only covers browser Speculation Rules, not the case that motivated the
plan.

The implementation was finished and green (a predicate with 8 tests, both guards,
package suite at 250) and was reverted anyway: it never fires for the motivating
case, and dead code is worse than no code.

## What came out of it instead

Two things, both shipped:

1. **A real defect, found while measuring.** A prefetch of a link in the other
   language rewrote the visitor's language cookie. Analysed in
   [`../specs/2026-08-05-language-write-from-proxy.md`](../specs/2026-08-05-language-write-from-proxy.md)
   and fixed by gating the cookie write on `sec-fetch-mode: navigate` — the surviving
   direction of the same question.
2. **The prefetch cost against Emporix** needs no package feature at all:
   `prefetch={false}` on the links that point at many expensive renders.

## Two traps worth remembering

- **`RSC` is not a prefetch signal.** Every client-side navigation sends it. Gating
  on it would have switched token rotation off entirely — a worse bug than the one
  being fixed.
- **A null result is not a confirmation.** During verification a request to a URL
  that 404s produced no `Set-Cookie`, and that was briefly misread as the guard
  working. The guard was not even in the running bundle at the time.

## Still open

`emporixRefresh` has no de-duplication. The guard would only have removed the
amplifier, not the race: two concurrent *real* navigations can still refresh in
parallel. A correct fix needs a lock, and a module-level `Map` does not qualify —
in an edge or serverless runtime it exists per instance. That needs the session
store and is its own piece of work.
