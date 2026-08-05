# Session cookie hardening — design

**Status:** approved (2026-08-03) — absolute ceiling decided at 90 days
**Date:** 2026-08-03
**Affects:** `packages/next` (`session-cookies.ts`, `session-auth.ts`, `token-proxy.ts`)
**Predecessor:** security review of 2026-07-30, findings **F-02** and **F-03**

## Goal

Three measures on the same cookies, in one go, because two of them invalidate the same
sessions and nobody should be logged out twice:

1. An **absolute ceiling** on session duration.
2. The **`__Host-` prefix** on all session cookies.
3. **Optional encryption** of the cookie contents.

## Measured foundations

### The session never expires today

That is the finding which sets the order of everything else.

`SESSION_MAX_AGE.refreshToken` sits at 30 days
([session-cookies.ts:10](../../../packages/next/src/session-cookies.ts#L10)), but
`persistSession` rewrites the cookie on **every** refresh — and `emporixRefresh` calls
`persistSession` ([session-auth.ts:162](../../../packages/next/src/session-auth.ts#L162)),
while the proxy calls `emporixRefresh` on every expired access token
([token-proxy.ts:63](../../../packages/next/src/token-proxy.ts#L63)).

So the 30 days are **30 days of inactivity**, not 30 days of session. Anyone dropping
by every few days stays signed in indefinitely. A stolen cookie somebody uses actively
never expires on its own.

### The cookie jar has to stay synchronous

`AnonymousSessionStore` is declared synchronous
([core/auth.ts:42-45](../../../packages/sdk/src/core/auth.ts#L42)):

```ts
read(): { refreshToken: string; sessionId: string } | null;
write(session: { refreshToken: string; sessionId: string } | null): void;
```

The SDK calls it in the middle of the token refresh (`auth.ts:195`, `:322`, `:379`),
synchronously. `session-client.ts` serves it out of the cookie jar. An `async`
`get`/`set` could no longer be plugged in.

**Consequence: WebCrypto is out.** `crypto.subtle` is asynchronous only. It has to be
`node:crypto` with `createCipheriv`/`createDecipheriv` — synchronous, and therefore
without any signature change.

That is sustainable, not merely permissible:

- `webhook.ts:1` **already** imports `node:crypto` (`createHmac`, `timingSafeEqual`).
  The precedent is in the package.
- The proxy is Node-runtime-only since Next 16 renamed `middleware` to `proxy` —
  `export const runtime = "edge"` throws there
  ([README:441-444](../../../packages/next/README.md)).
- The package keeps its **zero runtime dependencies**; `node:crypto` is built in.

### What is in the jar

| Cookie | Content | Who trusts it |
|---|---|---|
| `emporix.customerToken` | opaque Emporix token | Emporix validates |
| `emporix.refreshToken` | refresh token | Emporix validates |
| `emporix.saasToken` | **JWT** — payload readable by construction | Emporix validates |
| `emporix.customerTokenExpiresAt` | epoch seconds | **the app** (proxy decision) |
| `emporix.cartId` | cart id | **the app** |
| `emporix.anonymousSession` | `{refreshToken, sessionId}` | Emporix validates |
| `emporix.activeLegalEntityId` | legal entity id | **the app** — goes to `customers.refresh({legalEntityId})` ([session-auth.ts:150](../../../packages/next/src/session-auth.ts#L150)) |
| `emporix.siteCode`, `emporix.language` | site/language | browser-readable **on purpose** |

The three marked «the app» are the reason integrity protection is not vacuous here:
they are app-owned values the server believes, not tokens Emporix cross-checks.

## 1. Absolute session ceiling

The sliding window stays — it is the UX promise «you stay signed in». On top of it
comes a ceiling that does not slide along.

- `emporixLogin` writes `emporix.sessionStartedAt` (epoch seconds).
- `emporixRefresh` checks it first. Past the ceiling it clears the session like
  `emporixLogout` does and returns `null` — which the proxy already treats as «not
  signed in».
- `emporixLogout` deletes it too.

No new mechanism: `SESSION_EXPIRES_AT` is exactly the same pattern, and the enforcement
point already exists.

**Proposed values, need your sign-off:**

| Window | Proposal | Today |
|---|---|---|
| Idle (sliding) | 30 days | 30 days |
| **Absolute (new)** | **90 days** — decided | unlimited |

90 days is not a derivation but a judgement. For a B2C storefront it is comfortable and
caps the yield of a stolen cookie at one quarter. If viu serves B2B customers with
legal-entity switching, 30 days would be more appropriate — there a session carries more
than a shopping cart. Should viu serve that case seriously, the value deserves another
look — the mechanism is independent of the value, it is a constant.

## 2. `__Host-` prefix

`__Host-emporix.customerToken` instead of `emporix.customerToken`. The browser then
enforces `Secure`, `Path=/` and **no `Domain`** — a compromised subdomain cannot slip a
cookie in for the parent domain.

We already satisfy all three conditions
([session-cookies.ts:78-86](../../../packages/next/src/session-cookies.ts#L78)) but do
not use the prefix.

**The exception it needs:** on `http://localhost` the browser refuses `__Host-` cookies
because `Secure` is missing. The prefix therefore hangs off the same derivation as
`secure` does today — not a second switch, otherwise the two drift apart.

**The browser-readable ones stay unprefixed.** `emporix.siteCode` and
`emporix.language` are written by the site proxy and are deliberately JS-readable;
`__Host-` would not change that, but the name is in `STORAGE_KEYS` and is read by the
React package too. Renaming it there would be a change to another package for zero
security gain.

## 3. Encryption — opt-in

### Why optional

The benefit is real but narrow: encryption prevents **no** session hijack. Whoever has
the cookie is in, ciphertext or not. What it does buy:

- A plaintext `refreshToken` from a log or a HAR file is directly redeemable against
  `api.emporix.io` — past your rate limiting and past your logs. Ciphertext only works
  against your app.
- **Mass logout without a store:** drop the key from the list and every session is dead
  instantly. Today's stateless design cannot do that at all.
- Integrity for the three app-trusted values above.
- The `saasToken` JWT is otherwise readable, even after expiry.

That justifies an offer, not an obligation.

### Activation

`EMPORIX_COOKIE_SECRET` set → encrypted. Not set → as today.

The value is a **comma-separated list** of base64url-encoded 32-byte keys. The first
encrypts, all of them decrypt — without that, every rotation logs everybody out, which
effectively prevents rotation.

```
EMPORIX_COOKIE_SECRET="<new>,<old>"
```

A key that is too short or not decodable throws on first access, with the command to
generate one in the message. **No passphrases and no KDF:** anyone allowed to type a
passphrase types a weak one, and the KDF parameters would be one more thing that can be
wrong.

### Format

```
v1.<base64url(iv ‖ ciphertext ‖ tag)>
```

- **AES-256-GCM**, 12-byte IV from `randomBytes`, 16-byte tag. AEAD, not encryption
  alone — CBC without a MAC would be the classic mistake here.
- The `v1.` prefix allows a later algorithm change and makes it visible whether a value
  is encrypted at all.
- **The AAD is the cookie name.** Without it a `saasToken` ciphertext could be moved
  into the `customerToken` cookie.

### What gets encrypted

Every httpOnly cookie from the table above, `customerTokenExpiresAt` included. The
timestamp is not a secret, but the proxy *trusts* it, and one uniform rule is less
error-prone than an exception list somebody has to maintain.

`siteCode` and `language` stay plaintext — they are the purpose of the site proxy.

### Migration: everybody gets logged out

No plaintext fallback. Switching encryption on logs out every running session.

The alternative would be a transition window that also accepts plaintext — and because
the refresh cookie lives 30 days, that window would have to stay open for 30 days.
Throughout that whole time integrity protection for `cartId` and `activeLegalEntityId`
would be ineffective, and the switch would be something somebody has to remove
afterwards. A one-off logout is cheaper than both.

The same holds for the `__Host-` prefix: it changes cookie **names**, so the old ones
are no longer found. **That is why all three points land in one release** — one logout,
not two.

## Non-goals

- **Server-side sessions** (opaque id in the cookie, tokens in a store). Strictly
  stronger, because they can revoke *individual* sessions. Costs infrastructure the
  package does not need today, and is a decision of its own.
- **Refresh token reuse detection.** Needs support from Emporix. We measured during the
  server-first cycle that Emporix tolerates *anonymous* reuse — which argues against it,
  but is unverified for customer tokens. Measure first, then plan.
- **Changes to the React package.** Its storage adapters write cookies in the browser
  and by definition cannot hold a server-side secret. F-01 stays open for the SPA route.

## Tests

**Crypto** — `packages/next/tests/cookie-crypto.test.ts`, new:

| # | Expectation |
|---|---|
| 1 | Round trip: `decrypt(encrypt(x)) === x` |
| 2 | Ciphertext **differs** for identical plaintext (fresh IV) |
| 3 | A flipped byte in the ciphertext → throws (tag check) |
| 4 | Ciphertext of cookie A under name B → throws (AAD) |
| 5 | The second key in the list decrypts what the first cannot |
| 6 | Key no longer in the list → throws |
| 7 | A plaintext value without the `v1.` prefix → throws, rather than «returns garbage» |
| 8 | Key shorter than 32 bytes → throws on load, with the generation command |

Test 4 is the most valuable one: without AAD it still passes, and that is precisely the
interchangeability it is meant to prevent. It belongs under mutation testing.

**Jar and auth** — additions to `session-client.test.ts` / `session-auth.test.ts`:

| # | Expectation |
|---|---|
| 9 | Without `EMPORIX_COOKIE_SECRET` the cookie holds plaintext — the downgrade path |
| 10 | With a secret the token value is **not** in the cookie |
| 11 | `siteCode` stays plaintext in both cases |
| 12 | `__Host-` prefix set when the derived `secure` is true |
| 13 | No `__Host-` prefix over plain http |
| 14 | A refresh past the ceiling returns `null` and clears up |
| 15 | A refresh just below the ceiling rotates normally |
| 16 | The ceiling does **not** slide — ten refreshes do not move it |

Test 16 is the test for the finding at the very top. Without it the ceiling would slide
just like the window it is meant to bound.

## Open points

1. ~~**Does the encrypted `saasToken` fit the cookie limit?**~~ **Moot in store mode**
   (`2026-08-03-server-side-sessions-design.md`): the token sits in the store, where
   there is no size limit. **Still open in cookie mode** — there the arithmetic is
   `1.34 × (n + 28)` and the ceiling is around 2.9 KB of plaintext. Anyone running
   cookie mode with encryption should measure it once.
2. ~~**What is in the `saasToken` JWT?**~~ **Moot in store mode** — it no longer reaches
   the browser, so what an attacker could read from the payload is irrelevant. Also
   settled in cookie mode with encryption; the question only stays open in unencrypted
   cookie mode.
