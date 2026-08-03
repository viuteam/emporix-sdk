---
"@viu/emporix-sdk-next": minor
---

The server-first entry is `@viu/emporix-sdk-next/session`, not `/bff`.

`/bff` was never published — it exists only on the branch that introduced it —
so nothing to migrate. The rename happened because the name was wrong twice
over: the documentation calls this «server-first mode» everywhere, so a reader
had to learn two names for one thing; and «Backend for Frontend» describes a
separate deployable service per client type, which this is not — it is a set of
helpers running inside the same Next app.

`emporixSession` / `emporixSessionMutable` are now exported from `/session`
alongside `withEmporixSession` / `withEmporixSessionMutable`, where the two
families read as the pair they are: one returns the session values, the other
runs a callback with the session bound. Both remain exported from the package
root, where they shipped in 0.3.0.

Renamed with the entry, since «bff» should not survive in the API surface:

| Before | After |
|---|---|
| `BFF_MAX_AGE` | `SESSION_MAX_AGE` |
| `bffCookieJar` | `sessionCookieJar` |
| `BffCookieJar` | `SessionCookieJar` |

Cookie **names** are untouched — only the constants holding them changed, so
existing browser sessions survive.
