# Error reporting for `@viu/emporix-sdk-next`: a seam, not an integration

**Status:** design, not implemented.
**Scope:** `packages/next` only. No tool is chosen and none will be — the consumer
supplies the implementation.

## The situation

`packages/next` has **no observability seam of any kind**. `grep -riE
"telemetry|onError|reportError"` over `packages/next/src` returns nothing, and
[`client.ts:137`](../../../packages/next/src/client.ts) hard-codes `logger: false`,
so the one channel that does exist elsewhere in the repo is switched off here
without a stated reason.

Meanwhile the package contains **16 `catch` statements across 11 files**, forming
15 distinct failure points. Most are bare `catch {`. Several of them degrade a real
failure into a plausible-looking normal state:

```ts
// token-proxy.ts:75 — a Redis outage becomes «no session»
const record = sid === null ? null : await opts.store.read(sid).catch(() => null);

// session-auth.ts:142 — the guest cart is silently lost on login
} catch {
  // Ignore — the customer is logged in either way.
}
```

A store outage logs every visitor out and leaves no trace. That is the failure
class error reporting exists for, and today it is invisible.

## What already works, and why neither piece fits

**The SDK has a `Logger`** — `trace/debug/info/warn/error`, `child(bindings)`,
level-aware, plus `redact()` with a key list (`authorization`, `saas-token`,
`token`, `apikey`, …) that strips an `AuthContext` down to its `kind`. It is
injectable and it is the right redaction primitive. It is not an error reporter:
it writes to a console, and console-per-request in a serverless deployment
replaces silence with cost.

**The React package has a telemetry channel** — `onTelemetry`,
`useEmporixTelemetry`, and an `EmporixTelemetryEvent` union that already carries
`query.error` and `mutation.error`. But that union is a **React-Query lifecycle**:
`cache.hit`, `cache.miss`, `query.refetch`, `mutation.success`. In server-first
mode there is no React Query, so more than half the variants are meaningless.
Porting it would produce a union trying to be two things.

## The constraint that shapes the design

`getEmporixClient` is memoized per process, keyed on a **string**:

```ts
const key = `${tenant}|${clientId}|${host ?? ""}|${tagged}|${revalidate}|${JSON.stringify(opts.context ?? {})}|${JSON.stringify(opts.timeouts ?? {})}`;
```

A reporter is a function. `JSON.stringify` of a function is `undefined`, so it
cannot go in that key. Adding `reporter` as a `getEmporixClient` option would mean
**the first caller's reporter wins for the whole process**, silently, with the
second caller's never firing.

That forecloses the obvious design. The reporter cannot be per-client.

## Design

### One module-scope sink, registered once

```ts
// packages/next/src/error-reporting.ts
export interface EmporixErrorEvent {
  /** Stable, greppable identifier of the failure point. Never interpolated. */
  readonly code: EmporixErrorCode;
  /** What the package did as a result — the caller-visible consequence. */
  readonly degradedTo: string;
  readonly severity: "warning" | "error";
  /** The caught value, unchanged. Consumers fingerprint on its constructor. */
  readonly cause: unknown;
  /** Already redacted. Never contains a token, a cookie value or a secret. */
  readonly context: Readonly<Record<string, string | number | boolean>>;
}

export type EmporixErrorReporter = (event: EmporixErrorEvent) => void;

export function setEmporixErrorReporter(reporter: EmporixErrorReporter | null): void;
```

Registered in Next's `instrumentation.ts`, whose `register()` runs once per server
process before anything else:

```ts
// instrumentation.ts
export async function register() {
  setEmporixErrorReporter((e) => {
    myTool.captureMessage(e.code, { level: e.severity, extra: e.context, cause: e.cause });
  });
}
```

Module scope is exactly the lifetime the memoized client already has, so the two
agree instead of fighting.

**No implementation ships.** This mirrors `EmporixSessionStore`, which declares
three methods and ships nothing — the Redis version lives in
`examples/next-server-first/app/session-store.ts`. The same split here: the
interface in the package, one worked example in the example app. It also preserves
the package's zero-runtime-dependency property, which a vendor SDK would end.

### `code`, not a message

Every call site passes a literal from a closed union:

```ts
export type EmporixErrorCode =
  | "session.store.read_failed"
  | "session.flush_failed"
  | "session.cart_onboarding_failed"
  | "session.cookie_undecryptable"
  | "session.anonymous_cookie_unparseable"
  | "session.logout_upstream_failed"
  | "webhook.handler_failed"
  | "webhook.body_unparseable";
```

The SDK throws typed errors (`EmporixAuthError`, `EmporixNotFoundError`,
`EmporixInsufficientScopeError` with `requiredScope`), so `cause` carries a
constructor a consumer can group on. A consumer fingerprinting on `error.message`
gets one bucket per tenant and path, because the messages interpolate both — hence
`code` as the grouping key and `cause` as the detail.

### `degradedTo` is the point

A reporter that says «store read failed» is half a signal. What matters
operationally is that the request then **continued as a logged-out visitor**. Each
event states the consequence, so an on-call reader does not have to know the
package's internals to judge severity.

### Redaction is mandatory, not a consumer concern

`context` is assembled at the call site and passed through the SDK's `redact()`
before it reaches the reporter. Never raw. This package handles customer tokens,
refresh tokens and cookie encryption; a stack frame with an `Authorization` header
in scope, shipped to a third party and indexed there, is a credential leak. The
`context` type deliberately excludes `unknown` and objects — only primitives — so
there is no shape into which a token can be smuggled by accident.

`cause` is the exception: it is passed through unchanged, because a redacted
stack trace is useless. The doc must say plainly that `cause` may contain
whatever the thrower put in it, and that scrubbing it is the consumer's call.

### A reporter must never break a request

Every invocation is wrapped:

```ts
function report(event: EmporixErrorEvent): void {
  const r = reporter;
  if (r === null) return;
  try { r(event); } catch { /* a broken reporter must not become the failure */ }
}
```

Synchronous, and the return value is ignored. A reporter that wants to do I/O
queues it itself. This keeps the seam out of the request's critical path and means
`report()` can be called from inside a `catch` without a second failure mode.

**Behaviour at the call sites does not change.** `store.read(...).catch(() => null)`
still yields `null`; it only reports on the way. Any change to what the package
returns is out of scope for this work — the point is to make the existing
degradation visible, not to alter it.

## The inventory

The interface is an afternoon. This table is the work. Every one of the 15 failure
points, classified.

### Report — silent failures with user-visible or revenue consequences (5)

| Site | What fails | Degrades to | Code |
|---|---|---|---|
| `token-proxy.ts:75` | `store.read` during rotation | visitor treated as logged out, every request | `session.store.read_failed` |
| `session-cookies.ts:188` | `store.read` building the handle | same, inside the handle | `session.store.read_failed` |
| `session-auth.ts:142` | cart onboarding after login | **guest cart silently lost** | `session.cart_onboarding_failed` |
| `session-client.ts:175` | `flush` while unwinding a caller error | session left pointing at a token Emporix already invalidated | `session.flush_failed` |
| `webhook.ts:169` | the consumer's own `onEvent` | 500 so Emporix retries, no stack anywhere | `webhook.handler_failed` |

`webhook.handler_failed` is the highest-value one: it is the consumer's code
failing in the consumer's deployment, and today they get a bare 500.

### Report at `warning` — expected, but meaningful in aggregate (5)

| Site | What fails | Why it is worth a signal |
|---|---|---|
| `cookie-name.ts:53` | cookie decryption | a rotation dropped a key still in use, or tampering |
| `session-client.ts:84` | anonymous-session cookie `JSON.parse` | guest loses their session; format drift or tampering |
| `session-auth.ts:276` | upstream logout call | local session cleared, **server-side token not invalidated** |
| `webhook.ts:63` | body unparseable during signature check | malformed traffic at a signed endpoint |
| `webhook.ts:157` | body unparseable after it | same |

### Deliberately silent — reporting would be noise or a lever (5)

| Site | Why not |
|---|---|
| `tags.ts:48` | malformed URL in the public proxy's allowlist. Arbitrary attacker-controlled input; reporting it is a log-flooding lever. |
| `public-client.ts:49` | a relative URL is a routing branch, not a failure. |
| `public-route.ts:42` | `assertSameOrigin` rejecting cross-origin is the feature working. Expected traffic. |
| `cookie-crypto.ts:104` | per-key retry during rotation. The function **throws** when every key fails, and that throw is already visible. |
| `request-scope.ts:35` | rethrows after evicting the cache entry. The caller sees it. |

The last two matter: a naive «report every catch» pass would fire on key rotation
and on already-propagating errors, and would train the reader to ignore the
channel.

## Testing

- A registered reporter fires for each of the 10 reporting sites, with the right
  `code` and `degradedTo`. Drive each by making the seam fail (a store whose
  `read` rejects, an `onEvent` that throws, a cookie sealed with a dropped key).
- **No reporter registered** → the same paths behave exactly as they do today.
  This is the regression that matters: the seam must be free when unused.
- **A throwing reporter** does not change any outcome. Assert the caller still
  gets its original error, and the degraded value is still returned.
- **Redaction**: assemble a `context` at a site whose scope contains a token, and
  assert the reporter's payload contains no substring of it.
- The 5 deliberately-silent sites do **not** fire. Worth asserting explicitly, so
  a later refactor cannot quietly add noise.

## Deliberately not in scope

- **No tool adapter in the package.** One example adapter in
  `examples/next-server-first`, matching how `EmporixSessionStore` is handled.
- **Not turning `logger: false` back on.** A separate decision with a different
  cost profile; conflating them means neither gets judged on its merits.
- **No tracing, no metrics, no spans.** This is error reporting. A span API is a
  different shape (it needs start/end and context propagation) and pretending one
  interface serves both produces something that serves neither.
- **No changes to what any call site returns.** Visibility only.
- **`packages/sdk` and `packages/react` untouched.** The SDK already has its
  logger; React already has its telemetry channel.

## Assumptions to verify before implementing

- **`instrumentation.ts` `register()` really runs before the first request** on
  the target deployment, in every runtime the app uses. Documented for Next 16,
  not measured here. If it does not, a lazily-registered reporter misses the
  startup window — where store-connection failures live.
- **The proxy's reporting volume.** `token-proxy.ts` runs before every render. A
  store outage there produces one event per request, which is a bill and a
  rate-limit problem at any real traffic level. Either the consumer's adapter
  samples, or the package needs a per-code throttle. **Deciding this needs a
  traffic number nobody has yet** — it is the one open question that could change
  the interface (a `count` field, or a first-seen/last-seen envelope).
- **Whether `severity` is worth having** at all, versus letting the consumer map
  from `code`. Two levels may be too few to be useful and too many to be free.
- Nothing in this document has been measured against a running Next application.
  The call-site inventory is read from source; the operational claims about what
  each degradation costs are reasoned from the code and its comments, not observed
  in production.
