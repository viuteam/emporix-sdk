# emporix-sdk

TypeScript SDK for the [Emporix Commerce Engine](https://developer.emporix.io),
shipped as a pnpm workspace monorepo.

## Packages

| Package | Description |
| --- | --- |
| [`@viu/emporix-sdk`](./packages/sdk) | Core, framework-agnostic SDK: auth, HTTP, logging + Customer, Product, Category, Cart, Checkout, Payment, Price, Media, Segment, Site, SessionContext, Companies, Contacts, Locations, CustomerGroups (B2B) |
| [`@viu/emporix-sdk-react`](./packages/react) | React bindings: provider, hooks, storage adapters, SSR helpers |

Runnable examples live in [`examples/`](./examples): `node-server` (no React),
`vite-spa` (CSR), `next-app-router` (RSC + Server Actions). Example packages are
private and never published.

## Install

```bash
pnpm add @viu/emporix-sdk
# React bindings (peer deps: react, @tanstack/react-query v5)
pnpm add @viu/emporix-sdk-react @tanstack/react-query react
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

See [`packages/sdk/README.md`](./packages/sdk/README.md) and
[`packages/react/README.md`](./packages/react/README.md) for full guides, plus
[`docs/auth.md`](./docs/auth.md), [`docs/logging.md`](./docs/logging.md),
[`docs/react.md`](./docs/react.md).

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
