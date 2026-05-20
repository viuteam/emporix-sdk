---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Hook-only guest checkout + persistent anonymous cart.

**SDK (`@viu/emporix-sdk`)**

- New `AnonymousSessionStore` interface and optional `TokenProvider.attachAnonymousStore` method. When a host (e.g. `EmporixProvider`) supplies a store, `DefaultTokenProvider` bootstraps `anon` from the store on first use (taking the refresh-token path, so `sessionId` is preserved) and writes the rotated `refreshToken` + `sessionId` back after every login / refresh. With no store attached, behavior is identical to before.
- `invalidateAnonymous()` now also clears the attached store (`write(null)`).
- `EmporixClient.tokenProvider` is now a public, read-only field — so hosts can call `attachAnonymousStore` after construction.

**React (`@viu/emporix-sdk-react`)**

- `TokenStorage` renamed to `EmporixStorage` (alias `TokenStorage` is kept). New methods: `getCartId / setCartId`, `getAnonymousSession / setAnonymousSession`. All three storage backends — memory, `localStorage`, cookie — implement them.
- `EmporixProvider` wires the storage's anonymous-session accessors to the SDK's `attachAnonymousStore` so the anonymous cart can survive a browser reload.
- New `useCreateCart` mutation hook: auto-detects customer vs anonymous auth and persists `cartId` via `storage.setCartId`.
- `useCheckout` no longer throws on missing customer token — it auto-detects (customer if a token is stored, else anonymous). `usePaymentModes` keeps its customer-only behavior. Backward-compatible for existing logged-in flows.

**Migration**

No code change needed for existing consumers — both packages' changes are additive or strict supersets. New persistence kicks in automatically when consumers use one of the persistent storage backends (`createLocalStorageStorage()` or `createCookieStorage()`).
