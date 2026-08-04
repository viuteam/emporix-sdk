# emporix-sdk

[![CI](https://github.com/viuteam/emporix-sdk/actions/workflows/pr-check.yml/badge.svg?branch=main)](https://github.com/viuteam/emporix-sdk/actions/workflows/pr-check.yml)
[![@viu/emporix-sdk](https://img.shields.io/npm/v/@viu/emporix-sdk?label=%40viu%2Femporix-sdk)](https://www.npmjs.com/package/@viu/emporix-sdk)
[![@viu/emporix-sdk-react](https://img.shields.io/npm/v/@viu/emporix-sdk-react?label=%40viu%2Femporix-sdk-react)](https://www.npmjs.com/package/@viu/emporix-sdk-react)
[![@viu/emporix-mixins](https://img.shields.io/npm/v/@viu/emporix-mixins?label=%40viu%2Femporix-mixins)](https://www.npmjs.com/package/@viu/emporix-mixins)
[![@viu/emporix-sdk-next](https://img.shields.io/npm/v/@viu/emporix-sdk-next?label=%40viu%2Femporix-sdk-next)](https://www.npmjs.com/package/@viu/emporix-sdk-next)
[![license](https://img.shields.io/npm/l/@viu/emporix-sdk)](./LICENSE)
[![node](https://img.shields.io/node/v/@viu/emporix-sdk)](https://nodejs.org)

TypeScript SDK for the [Emporix Commerce Engine](https://developer.emporix.io),
shipped as a pnpm workspace monorepo.

## Packages

| Package | Description |
| --- | --- |
| [`@viu/emporix-sdk`](./packages/sdk) | Core, framework-agnostic SDK: auth, HTTP, logging + the full Emporix service surface — **catalog** (Product, Category, Price, Brand, Label, Catalog), **cart & checkout** (Cart, Checkout, Payment, Coupon, Tax, Shipping, Fee), **orders & fulfilment** (Orders, SalesOrders, Quote, Invoice, Returns, PickPack, Availability, Indexing), **customers & B2B** (Customer, CustomerAdmin, Companies, Contacts, Locations, CustomerGroups, Approval, RewardPoints, Segment, IAM), and **platform** (Site, SessionContext, TenantConfig, ClientConfig, Media, Schema, Webhooks, SequentialId, UnitHandling, Country, Currency, Vendor, ShoppingList, SepaExport, CloudFunctions, AI, RagIndexer, Import) |
| [`@viu/emporix-sdk-react`](./packages/react) | React bindings: provider, hooks, storage adapters, SSR helpers |
| [`@viu/emporix-mixins`](./packages/mixins) | Generic, tenant-agnostic toolkit to resolve Emporix mixins as typed values and keep them in sync with the Schema Service (runtime accessor + pluggable sources + `emporix-mixins` codegen CLI) |
| [`@viu/emporix-sdk-next`](./packages/next) | Next.js server bindings: URL-derived cache tags, cookie- or store-backed session for RSC and Server Actions, a **server-first mode** that keeps every Emporix token out of the browser (login, token proxy, site detection), service-account clients, webhook-driven `revalidateTag`. Needs no React. |

Five runnable examples live in [`examples/`](./examples) — see its
[README](./examples/README.md) for which one answers which question:

| Example | Shows |
|---|---|
| [`node-server`](./examples/node-server) | the SDK with no React at all |
| [`vite-spa`](./examples/vite-spa) | the smallest React integration (CSR) |
| [`storefront-demo`](./examples/storefront-demo) | a complete storefront, catalog → checkout → account (**places real orders**) |
| [`next-app-router`](./examples/next-app-router) | Next 16 with client-side hooks |
| [`next-server-first`](./examples/next-server-first) | Next 16 with **no Emporix token in the browser** |

Example packages are private and never published.

## Install

```bash
pnpm add @viu/emporix-sdk
# React bindings (peer deps: react, @tanstack/react-query v5)
pnpm add @viu/emporix-sdk-react @tanstack/react-query react
# Next.js server bindings — no React needed, not even for the session
pnpm add @viu/emporix-sdk-next next
# Typed mixins (optional — runtime accessor + codegen CLI)
pnpm add @viu/emporix-mixins
```

## Quick start

```ts
import { EmporixClient, auth } from "@viu/emporix-sdk";

const sdk = new EmporixClient({
  tenant: "mytenant",
  credentials: {
    backend: { clientId: "...", secret: "..." },
    storefront: { clientId: "..." },
  },
});

const products = await sdk.products.list();                 // anonymous
const { customerToken } = await sdk.customers.login({ email, password });
const me = await sdk.customers.me(auth.customer(customerToken));
```

See [`packages/sdk/README.md`](./packages/sdk/README.md),
[`packages/react/README.md`](./packages/react/README.md), and
[`packages/mixins/README.md`](./packages/mixins/README.md) for full guides, plus
[`docs/auth.md`](./docs/auth.md), [`docs/logging.md`](./docs/logging.md),
[`docs/react.md`](./docs/react.md), and [`docs/`](./docs) for per-service guides
(b2b, checkout, media, availability, returns, coupon, reward-points, approval, …).

## Development

```bash
nvm use          # picks Node 24 from .nvmrc (matches CI primary)
pnpm install
pnpm typecheck   # repo-wide (packages + examples)
pnpm test        # library packages
pnpm build       # library packages
```

CI exercises Node 20, 22, and 24 in the PR-check matrix; release + e2e run on
Node 24 LTS (`.github/workflows/*.yml`). The published packages'
runtime floor is `engines.node: ">=20.19.0"` — that's the support contract for
consumers, not a development requirement.

Root `build`/`test`/`lint` are scoped to `./packages/*` (the publishable
libraries); examples are excluded from the release gate but still typechecked.

## Releases — two-PR Changesets model

Versions are driven by [Changesets](https://github.com/changesets/changesets),
**not** commit messages (Conventional Commits are enforced only for history
hygiene — see [`CONTRIBUTING.md`](./CONTRIBUTING.md)).

1. Every PR that changes `packages/*/src/**` adds a changeset
   (`pnpm changeset`). CI enforces this unless the PR is labelled `no-release`.
2. Merging to `main` with unconsumed changesets makes the Changesets action
   open/update a **"Version Packages"** PR (version bumps + changelog).
3. Merging that PR publishes the changed packages to npm with provenance and
   creates GitHub releases.

Example packages (`@viu/emporix-examples-*`) are ignored by Changesets.

## Authors

- **Dominic Fritschi** — _Maintainer_ — [VIU](https://www.viu.ch)
- **Andreas Nebiker** — _Contributor_ — [VIU](https://www.viu.ch)
- The **Team at VIU** — _Contributors_ — [VIU](https://www.viu.ch)

## License

This project is licensed under the MIT License — see the [LICENSE](./LICENSE) file for details.
