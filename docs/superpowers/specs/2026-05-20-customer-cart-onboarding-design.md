# Customer-Cart-Onboarding on Login — Design

## Context

Emporix enforces **one open cart per customer per `siteCode`/`type`/`legalEntityId` tuple** (cart.yml note: "A customer can have multiple carts opened, but they have to be of a different type"). The existing storefront flow today:

1. Guest browses → anonymous cart is created in storage (`useCreateCart` already persists `cartId`).
2. Guest logs in → `useCustomerSession.login()` stores the customer token.
3. **Nothing else happens.** The anonymous cart is now orphaned (auto-deleted after 30 days of inactivity per Emporix) and the customer's existing open cart on Emporix is not loaded into the storefront.

Result: a returning customer sees an empty cart after login even when Emporix has their last open cart still active.

This design adds **automatic customer-cart adoption** to the login flow, using two Emporix capabilities the SDK already wraps (partially) or needs to extend:

- `GET /cart/{tenant}/carts?customerId=…&siteCode=…&create=true` — get-or-create the open customer cart (cart.yml:832-905).
- `POST /cart/{tenant}/carts/{cartId}/merge` — merge anonymous carts into a customer cart (already exposed as `client.carts.merge(...)`).

## Goals

- After `useCustomerSession.login()` succeeds: storage has a `cartId` that points to the customer's open Emporix cart.
- If the user had an anonymous cart before login: its items are merged into the customer cart, the anonymous cart goes `CLOSED` on the server, and `storage.cartId` is rewritten to the customer-cart id.
- If the user had no anonymous cart: the customer cart is loaded (or created on the fly via `create=true`).
- `siteCode` is read from `client.config.credentials.storefront.context.siteCode` (already exists for anonymous-login context). No new config required.
- All behavior is backward-compatible — a consumer that does nothing different sees a richer login flow; nothing else changes.

## Non-Goals

- Cart-merge UI / conflict resolution UX (Emporix merges deterministically per the rules in `core-commerce/carts`; the storefront just consumes the result).
- B2B-specific multi-cart flows (different `type` like `quote` vs `shopping`). We only handle the default cart type for now.
- `legalEntityId` propagation — optional, not in scope.
- Customer-side cart-merge UI ("you had X items in your guest cart — keep them?"). Out of scope; we merge silently as Emporix recommends.
- Handling `useCustomerSession.signup()` — we treat it identically to login (post-account creation, the same load+merge flow runs). If the use case for signup differs, follow-up plan.

## Architecture

### Layer 1: SDK — fix `CartService.getCurrent`

Today (`packages/sdk/src/services/cart.ts:70-77`):

```ts
async getCurrent(auth: AuthContext): Promise<Cart | null> {
  const carts = await this.ctx.http.request<Cart[]>({
    method: "GET",
    path: this.base(),
    auth: requireCartAuth(auth),
  });
  return carts[0] ?? null;
}
```

Problems:
- `siteCode` is **required** per spec — current call sends none → undefined-behavior or 400.
- No `create` option.
- Return type is `Cart[]` but spec says "only one cart is returned" — the request returns a single object, not an array.

Replacement:

```ts
async getCurrent(
  auth: AuthContext,
  opts: { siteCode: string; type?: string; legalEntityId?: string; create?: boolean },
): Promise<Cart | null> {
  const query: Record<string, string | number | boolean> = {
    siteCode: opts.siteCode,
  };
  if (opts.type !== undefined) query.type = opts.type;
  if (opts.legalEntityId !== undefined) query.legalEntityId = opts.legalEntityId;
  if (opts.create) query.create = "true";
  try {
    return await this.ctx.http.request<Cart>({
      method: "GET",
      path: this.base(),
      query,
      auth: requireCartAuth(auth),
    });
  } catch (e) {
    // No cart found and create=false → Emporix returns 404. Map to null.
    if (e instanceof EmporixHttpError && e.status === 404) return null;
    throw e;
  }
}
```

**BREAKING:** the signature changes (required `opts.siteCode`). Mitigation: no internal SDK consumer uses `getCurrent` today, and external usage is unlikely given the incomplete prior behavior. We bump as **minor** with a BREAKING note in the changeset.

### Layer 2: React — `useCustomerSession.login()` onboards the cart

Current login (rough sketch from `packages/react/src/hooks/use-customer-session.ts`):

```ts
const login = async (creds) => {
  const session = await client.customers.login(creds, …);
  storage.setCustomerToken(session.accessToken);
  // refetch /me; done.
};
```

Extended login:

```ts
const login = async (creds) => {
  const session = await client.customers.login(creds, { anonymousToken });
  storage.setCustomerToken(session.accessToken);

  // NEW: post-login cart onboarding
  const siteCode = client.config?.credentials?.storefront?.context?.siteCode;
  if (siteCode) {
    try {
      const anonCartId = storage.getCartId();
      const customerCart = await client.carts.getCurrent(
        auth.customer(session.accessToken),
        { siteCode, create: true },
      );
      if (customerCart && anonCartId && anonCartId !== customerCart.cartId) {
        await client.carts.merge(customerCart.cartId, [anonCartId], auth.customer(session.accessToken));
      }
      if (customerCart) storage.setCartId(customerCart.cartId);
    } catch (e) {
      // Cart onboarding is best-effort — don't fail login on cart trouble.
      logger.warn("post-login cart onboarding failed", e);
    }
  }
};
```

Key decisions:
- **Best-effort:** a 5xx on `getCurrent` or `merge` does **not** roll back the login. The user is logged in; cart onboarding can be retried (or the user sees an empty cart and can re-add manually). Logging through the SDK logger lets observers see failures.
- **No-op when `siteCode` is missing:** consumers without a configured storefront context (rare; current vite-spa has it) get unchanged behavior. No accidental cart creation for misconfigured apps.
- **Merge condition:** only merge if (a) an anonymous cart-id is in storage **and** (b) it's not already equal to the customer-cart-id (defensive — Emporix would reject merging a cart into itself, but checking is cheap).
- **`client.carts.merge` signature:** today the function is `merge(anonymousCartId, auth)`. Spec says the body takes `{ carts: [id1, id2, …] }` — so merging multiple at once is allowed. We extend the SDK signature to accept an array; existing callers with a single id still work via a string-or-array overload (or migration tip in the changeset).

### Layer 3: Same for signup

`useCustomerSession.signup()` triggers `customers.signup` → which already returns a session in many setups. After signup, the same cart-onboarding block runs. Same code, same best-effort semantics. Tests cover both.

### What does NOT change

- `useCreateCart` still persists the anonymous cartId. The new login flow consumes that storage entry when merging.
- `GuestCheckout.tsx` stays as-is. The vite-spa Login page (`App.tsx`) doesn't change either — its `useCustomerSession.login()` call automatically benefits from the new behavior.
- Anonymous-session persistence (the `feat/pagination-harmonize` PR work) stays. After login + merge, the anonymous refresh token is still in storage but its `sessionId` is no longer the cart owner — that's fine; the anonymous session is still usable for fresh guest browsing in another tab.

## Data Flow

### Returning customer with a guest cart

```
[guest browses]
  ↓ useCreateCart → cart-A created (anonymous), storage.cartId = "cart-A"
[guest fills cart]
[user clicks login]
  ↓ useCustomerSession.login({email, password})
    ↓ POST /customer/{tenant}/login → access token (+saas, refresh)
    ↓ storage.setCustomerToken(...)
    ↓ NEW: GET /cart/{tenant}/carts?siteCode=main&create=true (customer auth)
       → cart-B (existing or newly created)
    ↓ NEW: POST /cart/{tenant}/carts/cart-B/merge { carts: ["cart-A"] }
       → cart-A goes CLOSED, cart-B inherits items
    ↓ storage.setCartId("cart-B")
[useCart(cartId) auto-refetches via cache invalidation]
```

### Returning customer with no guest cart

```
[user opens app, hits Login directly]
  ↓ useCustomerSession.login(...)
    ↓ POST /customer/.../login → token
    ↓ storage.setCustomerToken
    ↓ NEW: GET /cart/.../carts?siteCode=main&create=true → cart-B (their saved cart)
    ↓ No merge — storage.cartId was null.
    ↓ storage.setCartId("cart-B")
[user sees their last session's cart restored]
```

### New customer signup, no guest cart

```
[user clicks signup]
  ↓ useCustomerSession.signup({email, password, profile})
    ↓ POST /customer/{tenant}/customers (+ implicit/explicit login)
    ↓ storage.setCustomerToken
    ↓ NEW: GET .../carts?create=true → cart-B (created fresh)
    ↓ storage.setCartId("cart-B")
```

### Cart-onboarding failure (best-effort)

```
[user logs in]
  ↓ login succeeds, token stored
  ↓ getCurrent → 500 (Emporix transient)
  ↓ catch → logger.warn(...)
[login resolves successfully; cart is empty until next mutation]
```

## Testing

### SDK unit tests (`packages/sdk/tests/services/cart.test.ts`)

- `getCurrent({ siteCode })` — happy path: GET with `?siteCode=main`, returns Cart.
- `getCurrent({ siteCode, create: true })` — sends `?siteCode=main&create=true`.
- `getCurrent({ siteCode })` returns `null` on 404.
- `getCurrent({ siteCode })` propagates non-404 errors.
- `carts.merge(targetId, [a, b], auth)` — POST body `{ carts: [a, b] }`.

### React hook tests (`packages/react/tests/use-customer-session.test.tsx`)

- `login()` calls `getCurrent` with the `siteCode` from `client.config.credentials.storefront.context.siteCode`, then writes the resulting `cartId` to storage.
- `login()` with a pre-existing anonymous `cartId` in storage calls `merge(customerCartId, [anonCartId])` and writes the customer cart-id to storage.
- `login()` when `siteCode` is undefined skips the cart-onboarding flow entirely.
- `login()` resolves successfully even if `getCurrent` throws (best-effort).
- `signup()` mirrors the same behavior.

### Runtime smoke (against `viu`)

1. Open vite-spa, navigate to `/guest`, click "Start guest cart" → cart-A created.
2. Navigate to `/account`, log in.
3. Verify in DevTools Network panel:
   - `POST /customer/viu/login` → 200.
   - `GET /cart/viu/carts?siteCode=main&create=true` → 200 (cart-B).
   - `POST /cart/viu/carts/<cart-B>/merge { carts: ["<cart-A>"] }` → 200.
4. Verify `localStorage.emporix.cartId` equals cart-B's id (not cart-A).
5. Log out, log back in without a guest cart: only the `GET /carts` call fires (no merge).

## Risk / Compatibility

| Change | Risk | Mitigation |
|---|---|---|
| `getCurrent` signature changes (siteCode required) | Low. Public API consumers can't have been using this reliably without siteCode. | Minor bump + BREAKING note in changeset; clear migration snippet. |
| `carts.merge` signature accepts array | Low. Old single-id usage stays via string-or-array param. | Overload, not replacement. |
| Auto-load on login | Adds 1–2 HTTP calls to login. Latency increase ~100–300ms in normal conditions. | Best-effort — login never blocks; failures are logged, not surfaced. |
| Silent merge could surprise users | Cart-merge is documented Emporix behavior; conflicts are resolved server-side per documented rules. | Document the behavior in `docs/react.md` and `docs/auth.md`; surface failures via `console.warn` for dev observability. |

**Changeset:** minor for both `@viu/emporix-sdk` (BREAKING-noted `getCurrent` signature) and `@viu/emporix-sdk-react` (new login behavior).

## File Structure

| File | Change |
|---|---|
| `packages/sdk/src/services/cart.ts` | `getCurrent(auth, opts)` reshaped; `merge(targetCartId, anonCartIds, auth)` accepts array (overload) |
| `packages/sdk/tests/services/cart.test.ts` | New tests for `getCurrent` + `merge` array form |
| `packages/sdk/src/index.ts` | (no export change — `CartService` already exported) |
| `packages/react/src/hooks/use-customer-session.ts` | Login + signup run cart-onboarding block after token is stored |
| `packages/react/tests/use-customer-session.test.tsx` | New onboarding tests (cart load, merge, siteCode-missing skip, best-effort failure) |
| `.changeset/customer-cart-onboarding.md` | Minor changeset, BREAKING noted |
| `docs/auth.md` | New "Customer cart on login" subsection |
| `docs/react.md` | Login behavior note + cross-link |

## Out-of-scope follow-ups

- B2B multi-cart support (per-type cart-onboarding, e.g. shopping + quote in parallel) — needs a separate plan when used.
- `legalEntityId`-aware cart-onboarding — same; additive when the use case appears.
- Cart-conflict UI ("X items had different quantities — merged to total") — needs UX design, not just SDK.
- Server-side cart-onboarding for the Next.js Example (next-app-router) — same pattern but with cookies / server-actions.
