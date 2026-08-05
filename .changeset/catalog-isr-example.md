---
"@viu/emporix-sdk-next": patch
---

Docs only for the package: `examples/next-server-first` now serves its catalog
from static, revalidated routes instead of rendering every visit, and the package
README's server-first section gains the rule that made it possible — a
`cookies()` read anywhere in a route's tree makes that route dynamic for good,
including a read in the shared header.

No package code changed. The example moved its catalog to `/[lang]/…`, turned
`?page=` and `?variant=` into path segments, and moved the two personalised bits
of the header into client islands backed by a new `/api/session/nav` route. The
result, measured against `next start`: `x-nextjs-cache: MISS` then `HIT` with
`s-maxage=3600` on category and product pages, while `/cart` stays
`private, no-cache, no-store`.
