# Managed Dashboard module

A Module Federation remote for the Emporix Managed Dashboard, wired to
`@viu/emporix-sdk-react` with a **host-owned** customer token.

Upstream, Emporix ships [`emporix/md-module-template`](https://github.com/emporix/md-module-template).
The dashboard loads the remote and passes one object:

```ts
type AppState = { tenant: string; language: string; token: string }
```

The module never authenticates. That `token` is a customer token whose scopes reach
operations a storefront token could not, which is what makes the React package usable here
at all — see the [Managed Dashboard section](../../packages/react/README.md#managed-dashboard-module-host-owned-token)
for the full recipe and the five things to get right.

## What this example does differently from the upstream template

- **No `@emporix/component-library`.** It does not resolve from the public npm registry, so
  depending on it would make this example unbuildable for anyone without registry access.
  The markup here is plain on purpose; the subject is the SDK wiring, not the design system.
- **`src/main.tsx` renders the remote itself** with an `appState` assembled from env vars, so
  `pnpm dev` runs standalone. The federation build is still configured, so the same source is
  loadable by the real dashboard.

## Running it

Create an untracked `.env.local` in this directory:

```
VITE_API_URL=https://api.emporix.io
VITE_DEMO_TENANT=<your tenant>
VITE_DEMO_LANGUAGE=de
VITE_DEMO_TOKEN=<a customer token from a dashboard session>
```

The token is the one the dashboard would hand the module. Take it from a live dashboard
session. **It is a credential — keep it in `.env.local`, which is gitignored, and never
commit it.**

```bash
pnpm -F @viu/emporix-examples-md-module dev
```

## Building the remote

```bash
pnpm -F @viu/emporix-examples-md-module build
```

Emits `dist/assets/remoteEntry.js` — Vite puts it under `assets/`, not at the `dist/` root,
which is the path the dashboard's remote entry must point at. The dashboard origin
`https://admin.emporix.io` is already in the dev-server and preview CORS allowlist in
`vite.config.ts`.

## What to look at

| File | Why |
| --- | --- |
| [`src/RemoteComponent.tsx`](./src/RemoteComponent.tsx) | the whole integration: `customerSession="external"`, `initialCustomerToken`, `initialLanguage`, `onCustomerSessionExpired` |
| [`src/emporix.ts`](./src/emporix.ts) | one client per tenant, `credentials: {}`, explicit `host` |
| [`src/ProductList.tsx`](./src/ProductList.tsx) | `useProducts` with `totalCount: true` — the "X of Y" a dashboard table wants |
| [`vite.config.ts`](./vite.config.ts) | what is shared with the host (`react`, `react-dom`) and what deliberately is not |
