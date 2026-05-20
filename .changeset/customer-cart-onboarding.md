---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Customer-cart onboarding on login. After `useCustomerSession.login()` (or the SSO flows `socialLogin` / `exchangeToken`) succeeds, the SDK now automatically loads (or creates) the customer's open Emporix cart for the configured `siteCode` and merges any guest cart into it. The resulting `cartId` is written into `EmporixStorage`, so the UI sees the cart immediately.

**SDK (`@viu/emporix-sdk`)**

- `EmporixClient.config` is now a public read-only field, so hosts can read static settings such as `storefront.context.siteCode` without re-plumbing.
- **BREAKING:** `CartService.getCurrent(auth)` is now `getCurrent(auth, { siteCode, type?, legalEntityId?, create? })`. `siteCode` is required per the Emporix spec. Returns `null` on 404; with `create: true`, Emporix creates a new cart if none matches.
- **BREAKING / fix:** `CartService.merge(anonymousCartId, auth)` is now `merge(customerCartId, anonymousCartIds: string[], auth)`. The old signature put the wrong cart-id in the path and sent an empty body — it never actually worked against Emporix. The new signature matches the documented contract (`POST /cart/{tenant}/carts/{customerCartId}/merge` with body `{ carts: […] }`).

**React (`@viu/emporix-sdk-react`)**

- `useCustomerSession.login()`, `socialLogin()`, and `exchangeToken()` now run a best-effort cart-onboarding step: `client.carts.getCurrent({ siteCode, create: true })` to load (or create) the customer cart, then `client.carts.merge(customerCartId, [anonCartId])` if a guest `cartId` was in storage, and finally `storage.setCartId(customerCartId)`. Failures are swallowed so login never blocks on cart trouble. Skipped silently if no `storefront.context.siteCode` is configured.

**Migration**

```ts
// SDK getCurrent:
- const cart = await client.carts.getCurrent(auth.customer(token));
+ const cart = await client.carts.getCurrent(auth.customer(token), { siteCode: "main" });

// SDK merge:
- await client.carts.merge(anonCartId, auth.customer(token));
+ await client.carts.merge(customerCartId, [anonCartId], auth.customer(token));
```

React consumers do not need to change anything — the new behavior kicks in automatically as long as the client's `storefront.context.siteCode` is set (the vite-spa Example already does).
