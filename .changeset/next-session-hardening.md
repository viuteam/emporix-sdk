---
"@viu/emporix-sdk-next": minor
---

Three changes to the session cookies, shipped together because two of them
invalidate every running session and nobody should be logged out twice.

**An absolute session ceiling of 90 days.** The idle window was never a limit:
`persistSession` rewrites the refresh cookie on every refresh, so the documented
30 days meant 30 days of *inactivity* and an actively used session never
expired. `emporix.sessionStartedAt` is stamped at login and never rewritten;
`emporixRefresh` clears the session and returns `null` once the ceiling is
passed. Sessions that predate this are adopted rather than dropped on deploy.

**The `__Host-` prefix** on every session cookie, which makes the browser
enforce Secure, Path=/ and no Domain — a compromised subdomain can no longer
inject a cookie for the parent domain. Dropped automatically over plain http,
where browsers refuse the prefix. Reads accept the bare name as a fallback, so
sessions written before this survive.

**Optional AES-256-GCM encryption**, on when `EMPORIX_COOKIE_SECRET` holds a
comma-separated list of base64url 32-byte keys. The first encrypts, all decrypt,
so keys rotate without logging everyone out — and removing a key is a
mass-logout lever the stateless design otherwise lacks.

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

What encryption buys, stated honestly: a stolen ciphertext cannot be redeemed
directly against Emporix, only replayed against your app, where you can
rate-limit and log. It does **not** prevent session hijacking.

**Turning encryption on logs every session out.** There is deliberately no
plaintext fallback: with a 30-day refresh cookie it would have to stay open for
30 days, and integrity protection for `cartId` and `activeLegalEntityId` would
be worthless for that whole window.

**Read session cookies through `sessionCookieJar`, not `cookies()`.** This is the
one footgun the feature introduces, and it fails quietly: with no secret set both
forms work, so a raw `cookies().get(STORAGE_KEYS.cartId)` passes review and only
breaks when someone enables encryption — at which point it returns the ciphertext
and hands Emporix a cart id it has never seen. Use
`sessionCookieJar({ readOnly: true })` in Server Components and
`sessionCookieJar()` in Server Actions.
