---
"@viu/emporix-sdk-react": minor
---

`STORAGE_KEYS` is now exported from `@viu/emporix-sdk-react/ssr`, and is the
single source of the eight persisted session keys.

`emporix.customerToken`, `emporix.cartId`, `emporix.anonymousSession`,
`emporix.siteCode`, `emporix.language`, `emporix.activeLegalEntityId`,
`emporix.refreshToken`, `emporix.saasToken` — cookie names in the cookie
backends, Web Storage keys in the localStorage/sessionStorage ones. Server code
that has to name a key without going through an `EmporixStorage` can read them
instead of duplicating the literal.

Internally the eight strings lived in three places: the `EmporixStorageKey`
union, the cookie backends and the Web Storage backends. They now come from one
object typed `satisfies Record<EmporixStorageKey, string>`, so a ninth session
key cannot be half-added — a union member without an entry, or an entry without
a union member, is a compile error.

Exported from `./ssr` rather than `./storage` on purpose: `./storage` carries
the `"use client"` banner and must not be imported from a Next `proxy.ts` or a
Route Handler. No behaviour changed, and no key name changed.
