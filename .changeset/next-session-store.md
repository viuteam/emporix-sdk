---
"@viu/emporix-sdk-next": minor
---

Session values can now live in a store you provide instead of in cookies. Pass
`store` and the browser keeps one opaque `emporix.sid`; everything else moves
server-side.

```ts
const store: EmporixSessionStore = {
  read: async (id) => …,
  write: async (id, record, ttlSeconds) => …,
  destroy: async (id) => …,
};
```

Three methods, and the package ships no implementation — that is what keeps it at
zero runtime dependencies. `examples/next-server-first` has a Redis one to copy.

**What this buys that encrypted cookies cannot:** deleting a single session.
`emporixLogout` destroys the record, and an operator holding the id can too.

It also removes three problems rather than mitigating them: the 4 KB per-cookie
limit no longer applies to the `saasToken`, its JWT payload never reaches the
browser, and `cartId` / `activeLegalEntityId` — the values the app itself trusts —
are not in the browser to tamper with.

Lifetimes are time-remaining, so a key dies exactly when its session does:
`SESSION_ABSOLUTE_MAX` minus time spent for a customer, a sliding
`SESSION_GUEST_MAX` (7 days) for a guest. Guests get a shorter window because in
store mode every visitor costs a key.

**Pass `store` to all three readers** — `withEmporixSession*`,
`emporixTokenProxy` and `emporixSession`. Forget it in one place and that place
silently falls back to cookie mode.

**The `withEmporixSession*` callback now receives the jar as a third argument.**
Use it rather than building your own with `sessionCookieJar()`: a second jar for
the same request mints its own session id and needs its own flush. Existing
callbacks that ignore the argument keep working.

**`EMPORIX_COOKIE_SECRET` is not applied in store mode.** Sealing a random id
buys nothing. Cookie mode keeps encryption unchanged.

**No admin API.** The store makes revocation possible; it is not shipped as a
feature. Revoking every session of one customer needs a `customerId → sid[]`
index, which your store can build from the record.

Also fixes a cookie-mode bug found while verifying this: turning encryption
**off** left sealed cookies being read as plaintext, so a `v1.…` ciphertext was
handed on as if it were a cart id. A sealed value with no key configured now
reads as absent.
