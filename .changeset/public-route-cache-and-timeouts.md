---
"@viu/emporix-sdk-next": minor
---

Two fixes from the 1'000-CCU analysis, both in this package.

**`createEmporixPublicRoute` caches.** It called `globalThis.fetch` with no cache
options and returned no `Cache-Control`, so every debounced keystroke in a
typeahead was a billed Emporix call for an answer every visitor shares — while its
own doc comment claimed «cached by Next once for all visitors». The upstream fetch
now carries the same `next: { tags, revalidate }` a Server Component's catalog read
gets, so the same webhook invalidates both, and the response carries
`Cache-Control: public, s-maxage=<revalidate>, stale-while-revalidate=60`. Errors
and the 403 for a forbidden path answer `no-store`: a 502 pinned for an hour would
outlive the outage that caused it.

**`timeouts` is configurable.** Neither `getEmporixClient` nor
`withEmporixSession` could set a request budget, so every consumer ran on the SDK
defaults — 10 s to headers, 60 s to the end of the body. At high concurrency that
is what turns one slow Emporix minute into a process full of parked requests. The
option is part of `getEmporixClient`'s memo key, so two budgets are two clients
rather than whichever one asked first.
