# sessionStorage adapter for `@viu/emporix-sdk-react` — Design

**Date:** 2026-06-14
**Branch:** `feat/session-storage-adapter`
**Status:** Approved (design)

## Summary

Add a `sessionStorage`-backed `EmporixStorage` adapter to the React package. It
gives consumers a per-tab, privacy-oriented persistence backend: session state
(customer token, cart id, anonymous session, site code, language, active legal
entity id, refresh token, saas token) survives a page reload (F5) but is cleared
when the tab closes and is **not** shared across tabs — the genuine
`sessionStorage` semantics.

Because `localStorage` and `sessionStorage` are both instances of the same
`Storage` interface, the shared get/set/subscribe wiring is extracted into one
internal helper that both adapters delegate to. The public naming is cleaned up
to mirror the platform globals (`createLocalStorage` / `createSessionStorage`),
retiring the `createLocalStorageStorage` stutter without a breaking change.

## Motivation

The chosen use case is **per-tab isolation / privacy**: a consumer wants tokens
and session state to disappear when the tab is closed and to stay isolated from
other tabs, while still surviving an in-tab reload. The existing adapters cover
in-memory (default, SSR-safe), `localStorage` (cross-tab, persistent), and
cookies. None of them provide tab-scoped persistence; `sessionStorage` is the
natural backend for it.

All 8 keys go uniformly into `sessionStorage` (no per-key split), matching the
all-or-nothing pattern of the existing adapters: the privacy property only holds
if everything is tab-scoped.

## Architecture

Approach: **extract a shared web-storage helper** (`localStorage` and
`sessionStorage` share the `Storage` interface, so the only differences are the
backing object, the availability check, and the warning text).

| File | Change | Purpose |
|---|---|---|
| `packages/react/src/storage/web-storage.ts` | new (internal) | `fromWebStorage(storage: Storage, opts: { key?: string }): EmporixStorage` — owns the 8 key constants and all get/set/`subscribe`/`subscribeAll` wiring, moved verbatim from `local-storage.ts`. Not exported from the public barrel. |
| `packages/react/src/storage/local-storage.ts` | modify | Thin wrapper: availability check for `globalThis.localStorage` → memory fallback → delegate to `fromWebStorage(localStorage, opts)`. Exports `createLocalStorage` (canonical) and `createLocalStorageStorage` (`@deprecated` alias pointing at the same function). |
| `packages/react/src/storage/session-storage.ts` | new | Same thin-wrapper shape against `globalThis.sessionStorage`; warning text references sessionStorage. Exports `createSessionStorage`. |
| `packages/react/src/storage/index.ts` | modify | Re-export `createSessionStorage` and `createLocalStorage` alongside the existing exports. |
| `packages/react/src/index.ts` | modify | Add `createSessionStorage` and `createLocalStorage` to the public export block. |
| `packages/react/tests/session-storage.test.ts` | new | Behaviour + isolation tests (see Testing). |
| `docs/react.md`, `README.md` | modify | Document `createSessionStorage` and the per-tab/privacy trade-off; note `createLocalStorage` is the new preferred name. |
| `.changeset/*.md` | new | `minor` — additive feature. |

### `fromWebStorage` (internal helper)

Signature: `fromWebStorage(storage: Storage, opts: { key?: string } = {}): EmporixStorage`.

- Holds the key constants currently in `local-storage.ts`:
  `emporix.customerToken` (overridable via `opts.key`), `emporix.cartId`,
  `emporix.anonymousSession`, `emporix.siteCode`, `emporix.language`,
  `emporix.activeLegalEntityId`, `emporix.refreshToken`, `emporix.saasToken`.
- Owns the per-instance `tokenListeners` set and the `createListenerSet`
  (`subscribeAll`) set. Each call creates its own sets.
- Implements every `EmporixStorage` method exactly as `local-storage.ts` does
  today (round-trip via `getItem`/`setItem`/`removeItem`, `null` → `removeItem`,
  `anonymousSession` via `parseAnonymousSession`/`JSON.stringify`).
- It does **not** perform the availability check or the memory fallback — the
  wrappers do that and only call the helper once a usable `Storage` exists.

### `createLocalStorage` / `createLocalStorageStorage`

```ts
export function createLocalStorage(opts: { key?: string } = {}): EmporixStorage {
  // availability check + memory fallback (unchanged)
  return fromWebStorage(globalThis.localStorage, opts);
}
/** @deprecated Use `createLocalStorage`. */
export const createLocalStorageStorage = createLocalStorage;
```

Both names stay exported (non-breaking). README/docs migrate to
`createLocalStorage`.

### `createSessionStorage`

```ts
export function createSessionStorage(opts: { key?: string } = {}): EmporixStorage {
  const available =
    typeof globalThis !== "undefined" &&
    typeof (globalThis as { sessionStorage?: Storage }).sessionStorage !== "undefined";
  if (!available) {
    console.warn("[emporix] sessionStorage unavailable; falling back to in-memory storage");
    return createMemoryStorage();
  }
  return fromWebStorage(
    (globalThis as unknown as { sessionStorage: Storage }).sessionStorage,
    opts,
  );
}
```

## Data flow

Identical to the localStorage adapter. The consumer passes the adapter to the
provider:

```tsx
<EmporixProvider client={client} storage={createSessionStorage()}>
```

Provider wiring (`DefaultTokenProvider` etc.) reads and writes session state
through the `EmporixStorage` interface; the shared helper persists to
`globalThis.sessionStorage`, scoped to the current tab. Telemetry rides on
`subscribeAll` inside the helper, so the sessionStorage adapter emits
`storage.write` events for free.

## Error handling

Backend-unavailable (SSR, or storage disabled) → `console.warn` +
`createMemoryStorage()`, mirroring the localStorage adapter **exactly**.

Deliberate parity decision: no try/catch write-probe (the Safari-private-mode
throw-on-access case). Adding it only to sessionStorage would diverge from the
existing localStorage adapter; keeping the two identical is the correct call. A
probe, if wanted later, is a separate follow-up applied to both adapters.

## Semantics (to document)

- Survives an in-tab reload (F5).
- Cleared when the tab/window closes.
- Not shared across tabs (the desired privacy property).
- A duplicated tab inherits a copy of the session storage (platform behaviour).
- No cross-tab `storage`-event syncing — the existing adapters don't do this
  either, so no behavioural change.

## Testing

Vitest + jsdom (`sessionStorage` is available in jsdom). TDD.

`packages/react/tests/session-storage.test.ts`:

- Round-trips all 8 keys through `createSessionStorage()` (set → get; `null` →
  cleared).
- Falls back to memory and warns when `sessionStorage` is undefined.
- `subscribe` (token) and `subscribeAll` (key) listeners fire on writes.
- **Isolation:** a write via the sessionStorage adapter lands in
  `globalThis.sessionStorage` and **not** in `globalThis.localStorage`.
- `createLocalStorage` parity: behaves like `createLocalStorageStorage` (and the
  deprecated alias still works).

The existing `storage.test.ts` / `storage-active-legal-entity.test.ts` must stay
green — proof the `local-storage.ts` refactor is behaviour-preserving.

## Release

- `pnpm changeset` → `minor` for `@viu/emporix-sdk-react`: adds the
  `createSessionStorage` adapter and the `createLocalStorage` alias; deprecates
  `createLocalStorageStorage` (still exported).

## Out of scope

- Renaming or removing `createLocalStorageStorage` (kept for back-compat).
- A storage-access write-probe / private-mode hardening (separate follow-up,
  would apply to both web-storage adapters).
- Cross-tab synchronisation via the `storage` event.
- Any change to the SDK core package — this is React-package-only.
