---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Multi-site MS-3: server-side session-context sync.

**SDK**
- `client.sessionContext.get()` — `GET /session-context/{tenant}/me/context`.
  Returns `null` (not throws) when the server returns 404 — i.e. when the
  user has not created a cart yet and no session-context exists.
- `client.sessionContext.patch(input)` — `PATCH /session-context/{tenant}/me/context`
  with optimistic-locking. Looks up `metadata.version` via GET first
  unless caller provides one. Returns `true` when applied, `false` when
  there is no session context yet (404 on the GET → patch skipped).
- New `SessionContext` and `SessionContextPatch` types.

**React**
- `setSite()` is now async. It flips local state + storage + cart-id
  + cache-invalidation synchronously (optimistic UI), then PATCHes the
  server. Skips the PATCH when no session exists yet (404 on GET).
- `useSiteContext()` gains `isSwitching: boolean` and
  `switchError: Error | null`. The optimistic state is NOT rolled back
  on PATCH failure — surface the error in UI; the next user interaction
  retries.

No breaking changes. Existing call sites continue to work — `setSite("X")`
without `await` still flips the UI; awaiting it blocks until the
server-side sync completes.
