---
"@viu/emporix-sdk-next": patch
---

Documents session management with two diagrams in the README, which ships in the
npm tarball — so this is a patch rather than nothing.

The first shows where a request goes: `proxy.ts` as the only place that can read
**and** write cookies before a render, then the split between
`withEmporixSession` (read-only jar), `withEmporixSessionMutable` (writes, then
flush) and `getEmporixClient()` (catalog, cacheable, no session), then the branch
on whether a customer token is in the jar, and finally cookie mode versus store
mode — including that `siteCode` and `language` stay cookies either way.

The second is a sequence diagram of `emporixLogin`, because the ordering between
its two jars is load-bearing and invisible in the code: the flush has to happen
before cart onboarding, or the second jar reads a store with no customer token and
runs as a guest. That was a released bug (0.4.1) and the diagram is cheaper than
the four wrong explanations that preceded the fix.

Both were rendered before committing, and the render caught two errors the source
did not show: an edge that claimed store mode writes every value to a cookie, and
a label clipped by its diamond.
