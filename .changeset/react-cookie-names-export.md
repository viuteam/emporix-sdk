---
"@viu/emporix-sdk-react": minor
---

`COOKIE_NAMES` is now exported from `@viu/emporix-sdk-react/ssr`.

The eight persisted session keys as cookie names — `emporix.customerToken`,
`emporix.cartId`, `emporix.anonymousSession`, `emporix.siteCode`,
`emporix.language`, `emporix.activeLegalEntityId`, `emporix.refreshToken`,
`emporix.saasToken`. Server code that has to name a cookie without going
through an `EmporixStorage` can now read them instead of duplicating the
literal.

Exported from `./ssr` rather than `./storage` on purpose: `./storage` carries
the `"use client"` banner and must not be imported from a Next `proxy.ts` or a
Route Handler. Nothing else changed — no behaviour, no existing export.
