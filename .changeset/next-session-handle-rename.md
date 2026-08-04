---
"@viu/emporix-sdk-next": minor
---

Renames `sessionCookieJar` to `emporixSessionHandle` and `SessionCookieJar` to
`EmporixSessionHandle`. **Nothing breaks:** both old names are still exported,
still the same function object, now marked `@deprecated`. They are scheduled for
removal in 0.6.0, and a test pins the identity so dropping them has to be
deliberate.

The old name described one of the two backends. Pass a `store` and six of the
eight `STORAGE_KEYS` live in the store record — only `siteCode` and `language`
stay cookies, plus the `emporix.sid` pointer — so «cookie jar» named a quarter of
what the thing holds. The local variable is `handle` throughout now; `jar` is left
only where it means Next's own `await cookies()`, which genuinely is one.

Migration is a find-and-replace:

```diff
-import { sessionCookieJar, type SessionCookieJar } from "@viu/emporix-sdk-next/session";
-const jar = await sessionCookieJar({ readOnly: true });
+import { emporixSessionHandle, type EmporixSessionHandle } from "@viu/emporix-sdk-next/session";
+const handle = await emporixSessionHandle({ readOnly: true });
```

Two doc corrections come with it, both about what the type actually guarantees:
«a narrow cookie surface» was only true before store mode existed, and the
`httpOnly` promise holds for the two public keys as well — «public» means they
stay cookies in store mode, not that JavaScript can read them. A browser-readable
site or language cookie is `emporixSiteProxy`'s job.
