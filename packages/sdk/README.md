# @viu/emporix-sdk

Framework-agnostic TypeScript SDK for the Emporix Commerce Engine. Native
`fetch` only (Node 18+), zero runtime dependencies.

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

`AuthContext` is **per call, never stored** — one client safely serves many
concurrent shoppers (SSR/edge/multi-tenant). SDK-managed (`service`/`anonymous`)
401s refresh-and-retry once; caller-managed (`customer`/`raw`) 401s propagate as
`EmporixAuthError`. Full details in [`../../docs/auth.md`](../../docs/auth.md).

## Logging

Structured, level-aware, per-service controllable, secret-redacting, zero
dependency. See [`../../docs/logging.md`](../../docs/logging.md).

## Subpath exports

`@viu/emporix-sdk` (everything) plus `./customer`, `./product`, `./category`,
`./cart` for tree-shaking.
