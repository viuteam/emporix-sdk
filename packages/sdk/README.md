# @viu/emporix-sdk

Framework-agnostic TypeScript SDK for the Emporix Commerce Engine. Native
`fetch` only (Node 20.19+), zero runtime dependencies.

## Install

```bash
pnpm add @viu/emporix-sdk
```

## Quick start

```ts
import { EmporixClient, auth } from "@viu/emporix-sdk";

const sdk = new EmporixClient({
  tenant: "mytenant",
  credentials: {
    backend: { clientId: "...", secret: "..." },
    storefront: { clientId: "..." },
    custom: { partner: { clientId: "...", secret: "..." } },
  },
});

// Anonymous browse
const products = await sdk.products.list();

// Authenticated shopper
const { customerToken } = await sdk.customers.login({ email, password });
const ctx = auth.customer(customerToken);
const me = await sdk.customers.me(ctx);
const cart = await sdk.carts.create({ currency: "EUR" }, ctx);
await sdk.carts.addItem(cart.id, { productId: "p_1", quantity: 2 }, ctx);

// Service account with a custom credential set
await sdk.products.list(undefined, auth.service("partner"));

// Externally-issued token (SSO/token-exchange done upstream)
await sdk.customers.me(auth.raw(externalJwt));
```

## Configuration

| Option | Default | Notes |
| --- | --- | --- |
| `tenant` (required) | — | lowercase, 3–16 chars, `^[a-z][a-z0-9]+$` |
| `credentials.backend` (required) | — | `{ clientId, secret, scope? }` — service token |
| `credentials.storefront` | — | `{ clientId }` — anonymous token (no secret) |
| `credentials.custom` | — | `Record<name, { clientId, secret, scope? }>` |
| `host` | `https://api.emporix.io` | |
| `timeouts` | `{ connectMs: 10000, readMs: 60000 }` | |
| `retry` | `{ maxAttempts: 3 }` | 5xx/429 backoff + jitter, respects `Retry-After` |
| `cache` | `{ expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 }` | token cache |
| `logger` | console @ `warn` | `false`, a `Logger`, or `{ level, services, pretty, redact }` |
| `tokenProvider` | built-in | inject for SSO/token-exchange |

## AuthContext per method

`auth.service(name?)`, `auth.anonymous()`, `auth.customer(token)`,
`auth.raw(token)`. The last argument of every service method is the
`AuthContext`; defaults below apply when omitted.

| Method | Default | Required kind |
| --- | --- | --- |
| `customers.signup` / `.login` / `.requestPasswordReset` / `.confirmPasswordReset` | `anonymous` | — |
| `customers.me` / `.update` / `.changePassword` / `.addresses.*` | — | `customer` or `raw` |
| `customers.anonymous()` | — | obtains anonymous session (token ignored) |
| `products.*` / `categories.*` (reads) | `anonymous` | — (pass `customer` for personalized pricing) |
| `carts.*` | — | explicit `customer` or `anonymous` |
| `carts.merge` | — | `customer` |
| `companies.*` / `contacts.*` / `locations.*` / `customerGroups.*` (B2B) | — | `customer` (reads need `*_read_own`; mutations need `*_manage`) |
| `media.*` (Asset CRUD + download) | `service` | `service` — server-only (`media.asset_read` / `media.asset_manage`); never call from the browser |

`AuthContext` is **per call, never stored** — one client safely serves many
concurrent shoppers (SSR/edge/multi-tenant). SDK-managed (`service`/`anonymous`)
401s refresh-and-retry once; caller-managed (`customer`/`raw`) 401s propagate as
`EmporixAuthError`. Full details in [`../../docs/auth.md`](../../docs/auth.md).

## Logging

Structured, level-aware, per-service controllable, secret-redacting, zero
dependency. See [`../../docs/logging.md`](../../docs/logging.md).

## Checkout & payment

`sdk.checkout.placeOrder(...)` / `.placeOrderFromQuote(...)` and
`sdk.payments.listPaymentModes(...)` / `.authorize(...)`. The `saas-token`
header, guest checkout and deferred payment are covered in
[`../../docs/checkout.md`](../../docs/checkout.md).

## B2B

`sdk.companies` (legal entities), `sdk.contacts` (contact assignments),
`sdk.locations` (HQ/warehouse/office), `sdk.customerGroups` (IAM groups,
read-only for now). Switching company scope is a customer-token rescope via
`sdk.customers.refresh({ refreshToken, legalEntityId })`. Mutations that the
customer's role lacks scope for surface as `EmporixInsufficientScopeError`
(extends `EmporixForbiddenError`, carries `requiredScope`). See
[`../../docs/b2b.md`](../../docs/b2b.md).

## Media

`sdk.media` covers the full `/media/{tenant}/assets/*` surface: create
(`uploadFile` / `link` / `create`), list (paginated, `PaginatedItems<Asset>`),
get, update (JSON metadata or BLOB multipart file-replacement via the
`replaceFile` sugar), remove, and download (resolves to either a redirect
URL for `PUBLIC` assets or an `ArrayBuffer` for `PRIVATE`). All endpoints
require a server-only scope — every call defaults to a `service`
`AuthContext`. Storefronts read media via `product.productMedia` (denormalised
on the product) or the `useProductMedia(productId)` hook, not by calling
the Media service directly. See [`../../docs/media.md`](../../docs/media.md).

## Subpath exports

`@viu/emporix-sdk` (everything) plus `./customer`, `./product`, `./category`,
`./cart`, `./checkout`, `./payment`, `./price`, `./media`, `./segment`,
`./companies`, `./contacts`, `./locations`, `./customer-groups` for tree-shaking.

## Authors

- **Dominic Fritschi** — _Maintainer_ — [VIU](https://www.viu.ch)
- **Andreas Nebiker** — _Contributor_ — [VIU](https://www.viu.ch)
- The **Team at VIU** — _Contributors_ — [VIU](https://www.viu.ch)

## License

This project is licensed under the MIT License — see the [LICENSE](./LICENSE) file for details.
