# Observability — Design

**Status:** Approved (2026-05-22)
**Scope:** `@viu/emporix-sdk` (small SDK-side addition) + `@viu/emporix-sdk-react`
**Breaking?** No. Entirely additive. No-op without an `onTelemetry` prop.

## Problem

Storefronts that ship `@viu/emporix-sdk-react` to production can't measure whether the Balanced caching profile (PR #41) is actually saving the quota it promised. They have no signal for cache hit-rate, error-rate, auth-refresh frequency, or which mutations dominate their tenant-quota footprint. Operations decisions become guesswork.

Today the SDK exposes a `logger` (debug-oriented, console/pino-style) and the React layer holds React-Query state internally. Neither is plumbed into a telemetry pipeline (Datadog, Sentry, custom analytics) that operators rely on for production tuning.

## Goal

Provide a single opt-in telemetry channel through `EmporixProvider` that emits a typed event stream covering:

1. Cache lifecycle (hit, miss, refetch, error)
2. Mutation lifecycle (success, error)
3. Auth-token refresh (anonymous + customer)
4. Storage writes (customerToken, cartId, siteCode, anonymousSession)
5. Consumer-emitted custom events (so the same channel handles app-side analytics)

Consumers receive the stream as a typed discriminated union via a callback prop. Custom events are dispatched through a `useEmporixTelemetry()` hook.

## Non-Goals

- Pre-built tracker adapters (Datadog / Sentry / Mixpanel) — out of scope. The spec ships the event stream; adapters live in user-land.
- Built-in sampling or rate-limiting — consumers implement their own (`if (Math.random() < 0.1) ...`).
- Built-in event batching — consumers batch in their handler if needed.
- Cross-tab storage events via `window.addEventListener('storage')` — separate feature (Cross-Tab-Sync follow-up).
- PII-redaction in event payloads — consumer is responsible for filtering in their handler.
- Tracing / span correlation (OpenTelemetry) — Phase-2 follow-up if requested.

## Glossary

| Term | Definition |
|---|---|
| **TelemetryEvent** | One member of the discriminated `EmporixTelemetryEvent` union. |
| **Source** | The system that emits events. Four sources: React-Query (cache + mutations), Token provider (auth refresh), Storage (writes), Consumer (custom). |
| **Sink** | The consumer's `onTelemetry` callback. Single sink per provider. |
| **emit** | The internal dispatch function that calls the sink. `useEmporixTelemetry()` exposes it for consumer-side custom events. |

## Target Architecture

```
                              ┌─────────────────────────────┐
                              │  consumer.onTelemetry(event) │
                              │  (Datadog, Sentry, custom)  │
                              └──────────────▲──────────────┘
                                             │
                              ┌──────────────┴──────────────┐
                              │   EmporixTelemetryContext    │
                              │   { emit(event) → sink }    │
                              └──────────────▲──────────────┘
                                             │
   ┌────────────┬────────────┬───────────────┴───────┬────────────┐
   │            │            │                       │            │
┌──┴───┐  ┌─────┴──────┐ ┌───┴────────────┐ ┌────────┴──────┐ ┌───┴─────┐
│ Query│  │ Mutation   │ │ TokenProvider  │ │ EmporixStorage │ │ Consumer│
│ Cache│  │ Cache      │ │ .onRefresh     │ │ .subscribeAll  │ │ .emit() │
│ subs │  │ subs       │ │ subs           │ │ subs           │ │         │
└──────┘  └────────────┘ └────────────────┘ └────────────────┘ └─────────┘
```

The provider subscribes to all four sources at mount and cleans up at unmount. Consumer-emitted events flow through the same context — Phase-2 sources (e.g. cross-tab) plug into the same channel without API changes.

## Event Shape

```ts
export type EmporixTelemetryEvent =
  // Cache lifecycle (React-Query QueryCache)
  | { type: "cache.hit"; queryKey: readonly unknown[]; tenant: string }
  | { type: "cache.miss"; queryKey: readonly unknown[]; tenant: string; durationMs: number }
  | { type: "query.refetch"; queryKey: readonly unknown[]; tenant: string; reason: "invalidate" | "focus" | "stale" }
  | { type: "query.error"; queryKey: readonly unknown[]; tenant: string; error: unknown }
  // Mutation lifecycle
  | { type: "mutation.success"; mutationKey?: readonly unknown[]; tenant: string; durationMs: number }
  | { type: "mutation.error"; mutationKey?: readonly unknown[]; tenant: string; error: unknown; durationMs: number }
  // Auth refresh (SDK-side)
  | { type: "auth.refresh"; kind: "anonymous" | "customer"; tenant: string; success: boolean }
  // Storage writes
  | { type: "storage.write"; key: "customerToken" | "cartId" | "siteCode" | "anonymousSession" }
  // Consumer-emitted
  | { type: "custom"; name: string; props?: Record<string, unknown> };
```

`queryKey` and `mutationKey` are the raw React-Query keys. `tenant` is always present on SDK-emitted events for multi-tenant tracking. Consumers writing `custom` events should namespace `name` (e.g. `"app.checkout-cta-clicked"`) to avoid collisions with future SDK event types.

## API Surface

### Provider prop

```tsx
<EmporixProvider
  client={client}
  storage={storage}
  onTelemetry={(event) => {
    // Discriminated union → exhaustive switch is type-safe.
    switch (event.type) {
      case "cache.hit":
      case "cache.miss":
        datadog.addAction(event.type, { key: event.queryKey, durationMs: event.durationMs ?? 0 });
        break;
      case "query.error":
      case "mutation.error":
        sentry.captureException(event.error, { tags: { type: event.type } });
        break;
      // … etc.
    }
  }}
>
```

`onTelemetry` is optional. Without it, all sources are no-op (no subscriptions registered, no overhead).

### Custom-event hook

```tsx
function CheckoutCTA() {
  const { emit } = useEmporixTelemetry();
  return (
    <button onClick={() => emit({ type: "custom", name: "checkout.cta-clicked" })}>
      Buy
    </button>
  );
}
```

`useEmporixTelemetry()` throws when used outside `EmporixProvider`. When no `onTelemetry` is configured, `emit` is a no-op stub (no error, no console noise).

### Optional SDK / storage extensions

Two additive interface members enable additional event sources:

```ts
// packages/sdk/src/core/auth.ts
export interface TokenProvider {
  // … existing methods …
  /** Subscribe to token-refresh events. Optional; implementations may no-op. */
  onRefresh?(listener: (event: { kind: "anonymous" | "customer"; success: boolean }) => void): () => void;
}
```

```ts
// packages/react/src/storage/index.ts
export interface EmporixStorage {
  // … existing methods …
  /** Subscribe to any storage write. Optional; backends may no-op. */
  subscribeAll?(
    listener: (key: "customerToken" | "cartId" | "siteCode" | "anonymousSession") => void,
  ): () => void;
}
```

Both members are `?`-marked. Custom `TokenProvider` / `EmporixStorage` implementations that don't add them continue to work — the corresponding telemetry events simply don't fire.

## Source Wiring

### Cache + Mutation events (React-Query)

The provider runs a single effect that subscribes to `qc.getQueryCache()` and `qc.getMutationCache()`:

```ts
useEffect(() => {
  if (!onTelemetry) return;
  const startedAt = new Map<string, number>(); // queryHash → ts for duration

  const unsubQuery = qc.getQueryCache().subscribe((event) => {
    const key = event.query.queryKey;
    if (!Array.isArray(key) || key[0] !== "emporix") return; // namespace gate

    if (event.type === "updated") {
      const action = event.action;
      if (action.type === "fetch") {
        const isRefetch = event.query.state.dataUpdateCount > 0;
        if (isRefetch) {
          safeEmit({
            type: "query.refetch",
            queryKey: key,
            tenant: client.tenant,
            reason: inferRefetchReason(event.query),
          });
        }
        startedAt.set(event.query.queryHash, Date.now());
      } else if (action.type === "success") {
        const start = startedAt.get(event.query.queryHash);
        startedAt.delete(event.query.queryHash);
        safeEmit({
          type: "cache.miss",
          queryKey: key,
          tenant: client.tenant,
          durationMs: start ? Date.now() - start : 0,
        });
      } else if (action.type === "error") {
        startedAt.delete(event.query.queryHash);
        safeEmit({
          type: "query.error",
          queryKey: key,
          tenant: client.tenant,
          error: event.query.state.error,
        });
      }
    } else if (event.type === "observerResultsUpdated") {
      // An observer subscribed and got served-from-cache without a network call.
      const s = event.query.state;
      if (s.status === "success" && s.fetchStatus === "idle" && s.dataUpdateCount > 0) {
        safeEmit({ type: "cache.hit", queryKey: key, tenant: client.tenant });
      }
    }
  });

  const unsubMut = qc.getMutationCache().subscribe((event) => {
    if (event.type !== "updated") return;
    const m = event.mutation;
    const dur = Date.now() - (m.state.submittedAt ?? Date.now());
    const mk = m.options.mutationKey;
    if (m.state.status === "success") {
      safeEmit({
        type: "mutation.success",
        ...(mk ? { mutationKey: mk } : {}),
        tenant: client.tenant,
        durationMs: dur,
      });
    } else if (m.state.status === "error") {
      safeEmit({
        type: "mutation.error",
        ...(mk ? { mutationKey: mk } : {}),
        tenant: client.tenant,
        error: m.state.error,
        durationMs: dur,
      });
    }
  });

  return () => {
    unsubQuery();
    unsubMut();
  };
}, [qc, onTelemetry, client.tenant]);
```

`safeEmit` wraps every dispatch in `try { onTelemetry(event) } catch { /* swallow */ }` — a consumer-side handler never breaks the provider.

`inferRefetchReason()` reads `query.state.fetchMeta` and the current event context to classify `"invalidate"` vs `"focus"` vs `"stale"`. Default is `"invalidate"` when uncertain. Heuristic, documented in tests; refinable in patch releases without API change.

### Auth refresh events

`DefaultTokenProvider` keeps a `Set<listener>` and calls `onRefresh(...)` after every refresh path (anonymous-login, anonymous-refresh, customer-refresh). Listeners receive `{ kind, success }` and the provider wraps:

```ts
useEffect(() => {
  if (!onTelemetry) return;
  return client.tokenProvider.onRefresh?.((evt) =>
    safeEmit({ type: "auth.refresh", ...evt, tenant: client.tenant }),
  );
}, [client, onTelemetry]);
```

Custom `TokenProvider` implementations without `onRefresh` simply emit no auth events.

### Storage writes

`createMemoryStorage`, `createLocalStorageStorage`, and `createCookieStorage` each gain a `subscribeAll(listener)` that maintains a `Set<listener>` and is invoked from each `setX(...)` method. Provider wires:

```ts
useEffect(() => {
  if (!onTelemetry) return;
  return storage.subscribeAll?.((key) => safeEmit({ type: "storage.write", key }));
}, [storage, onTelemetry]);
```

### Custom events

`EmporixTelemetryContext` exposes `{ emit }`. The provider sets `emit = onTelemetry ? safeEmit : noop`. Consumers call it from any component via `useEmporixTelemetry()`.

## Implementation Sketches

### Provider state

```ts
// New context, separate from EmporixContext / EmporixSiteContext.
const EmporixTelemetryContext = createContext<{ emit: (e: EmporixTelemetryEvent) => void } | null>(null);

// Inside EmporixProvider:
const safeEmit = useCallback(
  (e: EmporixTelemetryEvent) => {
    if (!onTelemetry) return;
    try {
      onTelemetry(e);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[emporix] telemetry handler threw:", err);
    }
  },
  [onTelemetry],
);

const telemetryValue = useMemo(() => ({ emit: safeEmit }), [safeEmit]);

// JSX wraps children with the new provider:
<EmporixTelemetryContext.Provider value={telemetryValue}>
  {/* … existing tree … */}
</EmporixTelemetryContext.Provider>
```

### Hook

```ts
export function useEmporixTelemetry(): { emit: (e: EmporixTelemetryEvent) => void } {
  const ctx = useContext(EmporixTelemetryContext);
  if (!ctx) {
    throw new Error("useEmporixTelemetry must be used within an EmporixProvider");
  }
  return ctx;
}
```

### DefaultTokenProvider — `onRefresh`

```ts
// packages/sdk/src/core/auth.ts (additive section)
class DefaultTokenProvider implements TokenProvider {
  private refreshListeners = new Set<(e: { kind: "anonymous" | "customer"; success: boolean }) => void>();

  onRefresh(listener: (e: { kind: "anonymous" | "customer"; success: boolean }) => void): () => void {
    this.refreshListeners.add(listener);
    return () => this.refreshListeners.delete(listener);
  }

  private notifyRefresh(kind: "anonymous" | "customer", success: boolean): void {
    for (const l of this.refreshListeners) {
      try { l({ kind, success }); } catch { /* swallow */ }
    }
  }
  // … existing methods call notifyRefresh after each refresh path …
}
```

### Storage — `subscribeAll`

```ts
// memory.ts (pattern; localStorage + cookie analogous)
export function createMemoryStorage(opts: { initial?: string } = {}): EmporixStorage {
  // … existing state …
  const allListeners = new Set<(key: "customerToken" | "cartId" | "siteCode" | "anonymousSession") => void>();
  const notify = (key: Parameters<typeof allListeners.add>[0] extends (k: infer K) => void ? K : never) => {
    for (const l of allListeners) try { l(key); } catch { /* swallow */ }
  };

  return {
    // … existing methods, each calls notify(...) after their state write …
    setCustomerToken: (t) => { token = t; notify("customerToken"); for (const l of tokenListeners) l(token); },
    setCartId: (id) => { cartId = id; notify("cartId"); },
    setSiteCode: (code) => { siteCode = code; notify("siteCode"); },
    setAnonymousSession: (s) => { anon = s; notify("anonymousSession"); },
    subscribeAll: (l) => { allListeners.add(l); return () => allListeners.delete(l); },
    // … rest …
  };
}
```

## Test Plan

| Test | File | Verifies |
|---|---|---|
| `cache.miss` event fires with positive `durationMs` on first fetch | `tests/telemetry.test.tsx` (new) | Subscribe-wiring + duration timing |
| `cache.hit` event fires on second mount (cache served, no network) | `tests/telemetry.test.tsx` | observerResultsUpdated hit detection |
| `qc.invalidateQueries(["emporix","X"])` triggers `query.refetch` with `reason: "invalidate"` | `tests/telemetry.test.tsx` | Refetch reason inference |
| `query.error` carries the original error | `tests/telemetry.test.tsx` | Error path |
| `mutation.success` + `mutation.error` carry `durationMs` | `tests/telemetry.test.tsx` | Mutation-cache subscription |
| Non-`emporix` query keys are filtered (consumer-app queries don't leak) | `tests/telemetry.test.tsx` | Namespace gate |
| `auth.refresh` fires for anonymous login + customer refresh, both `success` and `failure` variants | `packages/sdk/tests/core/auth.test.ts` (extend) | SDK-side wiring |
| `storage.write` fires for all 4 keys across all 3 backends | `tests/storage.test.ts` (extend) | Storage subscribeAll |
| `useEmporixTelemetry().emit({type:"custom",...})` reaches the consumer handler | `tests/telemetry.test.tsx` | Custom-event path |
| `useEmporixTelemetry()` without provider throws | `tests/telemetry.test.tsx` | Defensive error |
| `useEmporixTelemetry()` with provider but no `onTelemetry` returns a no-op emit (no throw) | `tests/telemetry.test.tsx` | Default behavior |
| Handler throw doesn't crash provider | `tests/telemetry.test.tsx` | safeEmit isolation |

**Test volume:** ~10 new tests in `telemetry.test.tsx`, +3 extended in `storage.test.ts` and SDK `auth.test.ts`.

## Migration

Entirely additive. Existing apps:
- Without `onTelemetry`: no behavior change, no overhead.
- With `onTelemetry`: receive the event stream; opt in to whatever they need.
- With custom `TokenProvider` lacking `onRefresh`: `auth.refresh` events don't fire. No error.
- With custom `EmporixStorage` lacking `subscribeAll`: `storage.write` events don't fire. No error.

## Changeset

```markdown
---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add opt-in telemetry channel for observability + ops-tuning.

**SDK (additive)**
- `TokenProvider.onRefresh(listener)` — optional subscription to
  token-refresh events. `DefaultTokenProvider` implements it.

**React (additive)**
- `<EmporixProvider onTelemetry={fn}>` — receives a typed event stream
  covering cache hit/miss, refetches, errors, mutations, auth refreshes,
  and storage writes.
- `useEmporixTelemetry()` — returns `{ emit }` for consumer-side custom
  events on the same channel.
- `EmporixStorage.subscribeAll(listener)` — optional subscription to all
  storage write events. Implemented in all three built-in adapters
  (memory, localStorage, cookie).

**Event types:**
- `cache.hit`, `cache.miss`, `query.refetch`, `query.error`
- `mutation.success`, `mutation.error`
- `auth.refresh`
- `storage.write`
- `custom`

No breaking changes. The entire telemetry layer is no-op when
`onTelemetry` is not passed. Existing `TokenProvider` / `EmporixStorage`
implementations continue to work without implementing the new optional
methods.
```

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Consumer-side handler throws → breaks provider | `safeEmit` wraps every dispatch in try/catch; log via `console.error`, never re-throw |
| `cache.hit` detection (via `observerResultsUpdated`) relies on React-Query 5 invariants | Tests document concrete scenarios; if RQ behavior changes between minor versions, fix in patch release |
| Auth-refresh listener leaks memory on provider unmount | Provider effect returns the unsubscribe function (standard React pattern); tests verify |
| Storage `subscribeAll` listener fires for keys consumer's not interested in | Acceptable — consumer filters in their handler; doc note |
| Custom event `name` collides with future SDK event types | Doc convention: consumer-namespace `name` with `app.*` (e.g. `"app.checkout-cta-click"`); SDK reserves bare names |
| `tenant` field exposes the tenant slug to analytics — could be sensitive | Tenant is already public (URL host). Documented; consumer can drop it in their handler before forwarding. |

## Out of Scope (Follow-ups)

- Pre-built tracker adapters (`@viu/emporix-sdk-react-datadog`, `@viu/emporix-sdk-react-sentry`).
- Cross-tab storage events via `window.addEventListener('storage')` (separate Cross-Tab-Sync feature).
- Built-in sampling / rate-limiting.
- OpenTelemetry span integration.
- PII / data-classification helpers for handler-side filtering.
