---
"@viu/emporix-sdk-next": minor
---

Share the read-only session handle within one request.

A page view builds the handle several times for the same record — the page,
whatever resolves the site context, `withEmporixSession` — and each build re-read
the cookies, re-derived `Secure` from the headers, and in store mode made its own
round trip to Redis. For data that cannot change mid-request. Measured on
`examples/next-server-first`: `/api/session/nav` has two construction sites and
now builds **one** handle; before this it built two.

Read-only handles are memoized on the object `await cookies()` returns, which
Next scopes to the request. **Mutable handles are deliberately not shared**:
`emporixLogin` builds one, flushes it, and lets the cart onboarding build a
second that must read what the first wrote. Collapsing those two would break
login in store mode, where the record only exists after a flush.

No React. `cache()` would have been the obvious tool and would have re-added the
dependency this package removed in 0.7.0; `AsyncLocalStorage` needs someone to
open the context, which Next does not offer a library. The `WeakMap` entry dies
with the request because nothing else holds the anchor.

Two limits worth knowing: the memo keys coarsely on «cookie mode» versus «store
mode», so an app running two different stores in one process would share an entry
— an app has one. And a rejected build is not cached, so a transient store outage
costs one failed read rather than poisoning every later read in the request.
