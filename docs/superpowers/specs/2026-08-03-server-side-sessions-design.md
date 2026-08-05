# Server-side sessions with a store adapter — design

**Status:** approved (2026-08-03)
**Date:** 2026-08-03
**Affects:** `packages/next`, `examples/next-server-first`
**Predecessor:** `2026-08-03-session-cookie-hardening-design.md` — listed there as a
non-goal, with the note «strictly stronger, costs infrastructure»

## Goal

The session values move out of the browser and into a store the consumer provides.
An opaque id stays in the cookie. That buys the one capability encrypted cookies
fundamentally cannot have: deleting a **single** session.

The store is an adapter with three methods. The package ships **no** store
implementation and keeps its zero runtime dependencies; the Redis adapter lives in
the example.

## The central mechanic

A store is async. `AnonymousSessionStore` is declared synchronous
([core/auth.ts:42-45](../../../packages/sdk/src/core/auth.ts#L42)) and gets called in
the middle of the token refresh. The same wall as with cookie encryption — but this
time cleanly solvable, because `sessionCookieJar()` is **already** async:

1. Read the session id from the cookie.
2. `await store.read(id)` → a flat `Record<string, string>`.
3. Return a **synchronous** jar over that record.
4. Mark changes in the record, then `await flush()` once at the end.

**Nothing above the jar changes.** `session-auth.ts` and `session-client.ts` stay as
they are. The store is an *implementation* of the jar, not a second code path — the
same shape that worked for encryption.

### Who flushes

Four places call `sessionCookieJar()`, all in the package, all async:

| Place | Flush? |
|---|---|
| `emporixLogin` ([session-auth.ts:66](../../../packages/next/src/session-auth.ts#L66)) | yes |
| `emporixRefresh` ([session-auth.ts:150](../../../packages/next/src/session-auth.ts#L150)) | yes |
| `emporixLogout` ([session-auth.ts:224](../../../packages/next/src/session-auth.ts#L224)) | yes, plus `destroy` |
| `run` in `session-client.ts:93` | only the **mutable** variant |

The read-only variant never flushes — that halves the number of places where a
forgotten flush is possible. Each entry point gets a test proving that a write
happened; that is the only safeguard against a fifth place forgetting it later.

## The adapter

```ts
export interface EmporixSessionStore {
  /** The record, or `null` when the id is unknown or expired. */
  read(id: string): Promise<Record<string, string> | null>;
  /** Replaces the record and sets its expiry. */
  write(id: string, record: Record<string, string>, ttlSeconds: number): Promise<void>;
  /** Removes the record. Must not throw when the id is unknown. */
  destroy(id: string): Promise<void>;
}
```

Three methods. `ttlSeconds` per write, so the store owns expiry (`SET … EX` on Redis).
No `touch`, no `list`, no `keys` — what nobody needs also cannot be implemented
wrongly.

`write` **replaces** the record entirely rather than merging. A merge would need
conflict rules for two parallel requests of the same session; replacing makes the last
writer win, which is the correct and expected semantics for session state.

### Wiring

`store?: EmporixSessionStore` in `WithEmporixSessionOptions`
([session-client.ts:11-25](../../../packages/next/src/session-client.ts#L11)). No
global state: forget it and you get no runtime error, simply cookie mode — and forget
it in the type and you get a type error.

`emporixTokenProxy` and `emporixSession` get the option too; both read cookies
directly today and in store mode would find only an id. Those are the **same two
places** that were overlooked during the cookie hardening — this time they are in the
plan up front.

## What stays in the cookie

| Cookie | Store mode |
|---|---|
| `emporix.sid` (**new**) | 32 random bytes base64url, httpOnly, `__Host-`, `maxAge` = remaining lifetime |
| `emporix.siteCode` | **stays a cookie** — deliberately browser-readable |
| `emporix.language` | **stays a cookie** — deliberately browser-readable |
| the other six | in the store |

The six that move: `customerToken`, `refreshToken`, `saasToken`, `cartId`,
`activeLegalEntityId`, `anonymousSession` — plus the two package-owned
`customerTokenExpiresAt` and `sessionStartedAt`.

`siteCode` and `language` **must** stay cookies: the site proxy writes them
browser-readable so a client-side language switch works. Pulling them into the store
would destroy the purpose of `emporixSiteProxy`.

### Three problems solve themselves along the way

- The **4 KB per-cookie limit** on the `saasToken` — open point 2 of the hardening
  spec. There is no size limit in the store.
- **What the `saasToken` JWT contains** — open point 3. Irrelevant once it never
  reaches the browser.
- **Integrity for `cartId` and `activeLegalEntityId`** — the app-owned values the
  server trusts. They are no longer in the browser at all, so there is nothing to
  tamper with.

### `EMPORIX_COOKIE_SECRET` is not applied in store mode

Encrypting a random id buys nothing — it is already meaningless without the store.
Cookie mode keeps its encryption unchanged; it is not removed, just not applied to the
`sid`. That belongs in the README explicitly, otherwise somebody sets both and expects
an effect.

## Lifetimes

The store TTL is the **remaining time**, not a fixed window. That way the key dies
exactly when the session dies, and there is no contradiction between a sliding TTL and
a non-sliding ceiling.

| Session | TTL on write |
|---|---|
| Customer (stamp present) | `SESSION_ABSOLUTE_MAX - (now - sessionStartedAt)` |
| Guest (no customer token) | `SESSION_GUEST_MAX`, sliding |

**Guest: 7 days, sliding.** An anonymous session has no account to protect, so there
is no reason for a hard ceiling either. What matters, measured, is that Emporix's
anonymous access token is valid for **1 hour** and gets renewed through the refresh
token — so the guest experience hangs off the refresh token, not off this TTL. Seven
days cover an abandoned cart comfortably and cut key retention by more than fourfold
against today's 30 days in the cookie.

**Why that counts:** today a guest costs nothing but cookies. In store mode **every**
visitor creates a key. Under bot traffic that is a real operational line item, and 7
days instead of 30 is the cheapest lever against it.

## What «revocation» means here — and what it does not

The store *can* delete a session, and `emporixLogout` does so via `destroy`. That is
the capability encrypted cookies do not have.

**There is no admin API.** An operator does not know the `sid`, they know the
customer. «Kill all sessions of customer X» would need a `customerId → sid[]` index,
and that is **not part of this work**: the record contains the customer id, a consumer
can build the index in their own store and then call `destroy`. Building it here would
mean inventing an index invalidation with cleanup logic that nobody asked for.

The honest sentence for the README: the store makes revocation **possible**, the
package does not ship it as a feature.

## The Redis adapter in the example

`examples/next-server-first/app/session-store.ts`, against `redis` (node-redis). As a
dependency of the **example**, not of the package.

A hand-written RESP client over `node:net` would be feasible and dependency-free, but
the example should show what a consumer really writes — and that is a real client with
reconnect and error handling.

```ts
// Memoized like getEmporixClient: a module-level connection would leak one
// socket per HMR reload in dev.
export function redisSessionStore(): EmporixSessionStore
```

Configured through `EMPORIX_SESSION_REDIS_URL`. Without it the store stays `undefined`
and the example runs in cookie mode — so both modes remain testable at any time
without changing code.

## Non-goals

- **No `customerId → sid[]` index.** See above.
- **No store in the package.** The interface yes, an implementation no. Otherwise the
  zero-dependency promise falls.
- **No merge in `write`.** Last writer wins.
- **No change to cookie mode.** It stays fully functional, encryption included, for
  consumers without a store.
- **No change to the React package.** A browser storage adapter cannot address a
  server-side store. F-01 stays open for the SPA route.

## Tests

**Store jar** — `packages/next/tests/session-store.test.ts`, new, against a
`Map`-backed fake store (in the test file, not exported):

| # | Expectation |
|---|---|
| 1 | Without `store` everything behaves as it does today — values land in cookies |
| 2 | With `store` the cookie holds only `emporix.sid`, no token |
| 3 | The `sid` is httpOnly and `__Host-` prefixed over https |
| 4 | A value written through the jar sits in the store after the flush |
| 5 | A second request with the same `sid` reads it back |
| 6 | An unknown `sid` behaves like an empty session, not an error |
| 7 | `emporixLogout` calls `destroy` and deletes the `sid` cookie |
| 8 | `siteCode` stays a cookie in store mode too |
| 9 | The read-only variant does **not** write to the store |
| 10 | A store whose `read` throws yields an empty session rather than a 500 |

**Lifetimes**:

| # | Expectation |
|---|---|
| 11 | Customer TTL is the remaining time to the ceiling, not `SESSION_ABSOLUTE_MAX` |
| 12 | Guest TTL is `SESSION_GUEST_MAX` and slides across several writes |
| 13 | A session beyond the ceiling is cleared out, `destroy` included |

**All three readers**:

| # | Expectation |
|---|---|
| 14 | `emporixTokenProxy` finds the token in the store, not in the cookie |
| 15 | `emporixSession` reads the session from the store |
| 16 | `withEmporixSession` resolves customer/anonymous correctly from the store |

Test 9 is the most valuable one: without it a Server Component render might write to
the store, which Next prevents for cookies but not for a store — the bug would be
invisible and would silently move state. It belongs under mutation testing.

Test 1 is the second most important: it is the proof that cookie mode stays untouched.

**Live against Redis** — running in Podman on 6379, verified with `+PONG`:

1. Guest: fill a cart, `redis-cli KEYS 'emporix:*'` shows **one** key.
2. The cookie jar in the browser contains **only** `emporix.sid` and
   `emporix.siteCode`.
3. `/debug` stays green.
4. Delete that same key by hand → `/cart` says «No cart yet». That is the revocation
   of a *single* session, live.
5. `redis-cli TTL <key>` sits at ~7 days for the guest.
6. Logged in: the same flow, TTL at ~90 days, `saasToken` in the record and not in the
   browser.

Point 4 is the actual proof of this whole piece of work. Point 6 requires a login and
therefore the user's own hand on the password field.

## Open points

1. **One read per session operation.** `emporixLogin` and `emporixRefresh` call
   `sessionCookieJar()` once each, `withEmporixSession*` likewise. A page calling
   `withEmporixSession` twice therefore reads from the store twice. Memoizing per
   request would be possible via React's `cache()`, but that does not work in the
   proxy, which is not a React context. Measure first whether it hurts.
2. **No locking.** Two parallel requests of the same session can overwrite each other.
   For session state that is acceptable; for the token refresh it means two concurrent
   refreshes redeem the same refresh token. We measured that Emporix tolerates this for
   anonymous tokens; for customer tokens it is unverified and belongs under
   observation.
