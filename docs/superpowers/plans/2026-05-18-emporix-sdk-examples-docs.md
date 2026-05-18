# Emporix SDK — Plan 4: Examples & Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three runnable example apps (`node-server`, `vite-spa`, `next-app-router`) and the full documentation set (root + package READMEs, CONTRIBUTING, `docs/logging.md`, `docs/auth.md`, `docs/react.md`), and re-instate the Changesets examples-ignore glob.

**Architecture:** Examples are private (`"private": true`) workspace packages under `examples/*`, named `@viu/emporix-examples-*`, never published. They consume the published package interfaces (`@viu/emporix-sdk`, `@viu/emporix-sdk-react`) via `workspace:*`. Root recursive `build`/`test`/`lint` are scoped to `./packages/*` (publishable libs) so heavy example builds never gate releases; `typecheck` stays repo-wide for correctness.

**Tech Stack:** Node + tsx (node-server), Vite + React + react-router-dom (vite-spa), Next.js 14 App Router (next-app-router). Docs are Markdown.

**Spec:** `docs/superpowers/specs/2026-05-17-emporix-sdk-design.md` §10, §12 examples; milestones 15–18. Carried deviation: re-add `.changeset` `ignore: ["@viu/emporix-examples-*"]` (now valid since example packages exist).

**Verification note:** `next build` needs a heavier toolchain than the CI library gate; example correctness is verified via per-package `typecheck` (repo-wide `pnpm typecheck`). Each example README documents its run command. The library packages keep the full `typecheck && test && build` gate.

---

## File Structure (this plan)

```
package.json                              root scripts scoped to ./packages/*
.changeset/config.json                    re-add ignore: ["@viu/emporix-examples-*"]
examples/node-server/{package.json,tsconfig.json,src/main.ts,README.md}
examples/vite-spa/{package.json,tsconfig.json,vite.config.ts,index.html,src/*,README.md}
examples/next-app-router/{package.json,tsconfig.json,next.config.mjs,next-env.d.ts,
  app/{layout.tsx,page.tsx,providers.tsx,cart/page.tsx,actions.ts},README.md}
README.md                                 root: monorepo overview + two-PR release
packages/sdk/README.md                    install, quick start, config, AuthContext table, logging
packages/react/README.md                  provider, hooks, SSR
CONTRIBUTING.md                           conventional commits + changesets workflow
docs/logging.md docs/auth.md docs/react.md
.changeset/examples-docs.md
```

Each example is self-contained and single-purpose. Docs are independent files.

---

## Task 1: Root script scoping + node-server example + re-add changeset ignore

**Files:**
- Modify: `package.json` (root scripts), `.changeset/config.json`
- Create: `examples/node-server/package.json`, `tsconfig.json`, `src/main.ts`, `README.md`

- [ ] **Step 1: Scope root recursive scripts to publishable packages**

In root `package.json` replace the `build`, `test`, `lint` scripts (leave
`typecheck` repo-wide):

```json
    "build": "pnpm -r --filter \"./packages/*\" build",
    "test": "pnpm -r --filter \"./packages/*\" test",
    "lint": "pnpm -r --filter \"./packages/*\" lint",
    "typecheck": "pnpm -r typecheck",
```

- [ ] **Step 2: Create `examples/node-server/package.json`**

```json
{
  "name": "@viu/emporix-examples-node-server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/main.ts",
    "typecheck": "tsc --noEmit",
    "build": "tsc --noEmit",
    "test": "echo \"(no tests for example)\" && exit 0",
    "lint": "echo \"(lint skipped for example)\" && exit 0"
  },
  "dependencies": {
    "@viu/emporix-sdk": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 3: Create `examples/node-server/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"], "noEmit": true },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `examples/node-server/src/main.ts`**

```ts
/* eslint-disable no-console */
import { EmporixClient, auth } from "@viu/emporix-sdk";

/**
 * Plain Node usage (no React): proves the core SDK works standalone for
 * backend tasks such as catalog sync. Run with: pnpm --filter
 * @viu/emporix-examples-node-server start
 */
async function main(): Promise<void> {
  const tenant = process.env.EMPORIX_TENANT ?? "mytenant";
  const sdk = new EmporixClient({
    tenant,
    credentials: {
      backend: {
        clientId: process.env.EMPORIX_BACKEND_CLIENT_ID ?? "",
        secret: process.env.EMPORIX_BACKEND_CLIENT_SECRET ?? "",
      },
      storefront: { clientId: process.env.EMPORIX_STOREFRONT_CLIENT_ID ?? "" },
    },
    logger: { level: "info" },
  });

  // Anonymous catalog read.
  const page = await sdk.products.list({ pageSize: 10 });
  console.log(`Fetched ${page.items.length} products for tenant "${tenant}"`);

  // Service-account write context (example only — no call made).
  const serviceCtx = auth.service();
  console.log(`Service context kind: ${serviceCtx.kind}`);

  // Stream the whole catalog lazily.
  let count = 0;
  for await (const _product of sdk.products.listAll({ pageSize: 50 })) {
    count += 1;
    if (count >= 100) break; // cap the demo
  }
  console.log(`Iterated ${count} products via listAll()`);
}

main().catch((err) => {
  console.error("example failed:", err);
  process.exit(1);
});
```

- [ ] **Step 5: Create `examples/node-server/README.md`**

```md
# Emporix SDK — Node server example

Plain Node.js usage of `@viu/emporix-sdk` (no React). Demonstrates anonymous
catalog reads, a service auth context, and `listAll()` streaming.

## Run

\`\`\`bash
cp ../../packages/sdk/.env.example .env   # fill in real credentials
pnpm --filter @viu/emporix-examples-node-server start
\`\`\`

Environment variables: `EMPORIX_TENANT`, `EMPORIX_BACKEND_CLIENT_ID`,
`EMPORIX_BACKEND_CLIENT_SECRET`, `EMPORIX_STOREFRONT_CLIENT_ID`.
```

- [ ] **Step 6: Re-add the Changesets examples-ignore glob**

In `.changeset/config.json`, add the `ignore` key back (now valid — a matching
package exists):

```json
  "updateInternalDependencies": "patch",
  "ignore": ["@viu/emporix-examples-*"],
  "privatePackages": { "version": false, "tag": false }
```

- [ ] **Step 7: Install and verify**

Run: `pnpm install`
Run: `pnpm changeset status --since=HEAD`
Expected: no config validation error (glob now matches the node-server package).
Run: `pnpm --filter @viu/emporix-examples-node-server typecheck`
Expected: PASS.
Run: `pnpm --filter @viu/emporix-sdk build && pnpm --filter @viu/emporix-examples-node-server typecheck`
Expected: PASS (sdk types resolve through the workspace).

- [ ] **Step 8: Commit**

```bash
git add package.json .changeset/config.json examples/node-server pnpm-lock.yaml
git commit -m "feat(examples): add node-server example and scope root scripts to packages"
```

---

## Task 2: vite-spa example

**Files:**
- Create: `examples/vite-spa/{package.json,tsconfig.json,tsconfig.node.json,vite.config.ts,index.html,src/main.tsx,src/App.tsx,README.md}`

- [ ] **Step 1: Create `examples/vite-spa/package.json`**

```json
{
  "name": "@viu/emporix-examples-vite-spa",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsc --noEmit",
    "test": "echo \"(no tests for example)\" && exit 0",
    "lint": "echo \"(lint skipped for example)\" && exit 0"
  },
  "dependencies": {
    "@tanstack/react-query": "^5.51.0",
    "@viu/emporix-sdk": "workspace:*",
    "@viu/emporix-sdk-react": "workspace:*",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create `examples/vite-spa/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM"],
    "types": [],
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `examples/vite-spa/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({ plugins: [react()] });
```

- [ ] **Step 4: Create `examples/vite-spa/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Emporix SDK — Vite SPA example</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `examples/vite-spa/src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider, createLocalStorageStorage } from "@viu/emporix-sdk-react";
import { App } from "./App";

const client = new EmporixClient({
  tenant: import.meta.env.VITE_EMPORIX_TENANT ?? "mytenant",
  credentials: {
    backend: { clientId: "unused-in-spa", secret: "unused-in-spa" },
    storefront: { clientId: import.meta.env.VITE_EMPORIX_STOREFRONT_CLIENT_ID ?? "" },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <EmporixProvider client={client} storage={createLocalStorageStorage()}>
        <App />
      </EmporixProvider>
    </BrowserRouter>
  </StrictMode>,
);
```

- [ ] **Step 6: Create `examples/vite-spa/src/App.tsx`**

```tsx
import { useState } from "react";
import { Route, Routes, Link } from "react-router-dom";
import { useProducts, useCustomerSession } from "@viu/emporix-sdk-react";

function Catalog(): React.JSX.Element {
  const { data, isLoading } = useProducts({ pageSize: 12 });
  if (isLoading) return <p>Loading…</p>;
  return (
    <ul>
      {data?.items.map((p) => (
        <li key={p.id}>{p.name ?? p.id}</li>
      ))}
    </ul>
  );
}

function Login(): React.JSX.Element {
  const { login, logout, isAuthenticated, customer } = useCustomerSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  if (isAuthenticated) {
    return (
      <div>
        <p>Signed in as {customer?.email ?? "…"}</p>
        <button onClick={logout}>Log out</button>
      </div>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void login({ email, password });
      }}
    >
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="password"
      />
      <button type="submit">Log in</button>
    </form>
  );
}

/** SPA root: anonymous catalog browse + customer login (token in localStorage). */
export function App(): React.JSX.Element {
  return (
    <main>
      <nav>
        <Link to="/">Catalog</Link> | <Link to="/account">Account</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Catalog />} />
        <Route path="/account" element={<Login />} />
      </Routes>
    </main>
  );
}
```

- [ ] **Step 7: Create `examples/vite-spa/README.md`**

```md
# Emporix SDK — Vite SPA example

Pure client-side React app: anonymous catalog browse and customer login with
the token persisted in `localStorage` (anonymous→login→cart-merge handled by
the SDK on login).

## Run

\`\`\`bash
VITE_EMPORIX_TENANT=mytenant VITE_EMPORIX_STOREFRONT_CLIENT_ID=xxx \
  pnpm --filter @viu/emporix-examples-vite-spa dev
\`\`\`
```

- [ ] **Step 8: Install, typecheck, build**

Run: `pnpm install`
Run: `pnpm --filter @viu/emporix-sdk build && pnpm --filter @viu/emporix-sdk-react build`
Run: `pnpm --filter @viu/emporix-examples-vite-spa typecheck`
Expected: PASS.
Run: `pnpm --filter @viu/emporix-examples-vite-spa build`
Expected: `vite build` succeeds (a `dist/` is produced).

- [ ] **Step 9: Commit**

```bash
git add examples/vite-spa pnpm-lock.yaml
git commit -m "feat(examples): add vite-spa example"
```

---

## Task 3: next-app-router example

**Files:**
- Create: `examples/next-app-router/{package.json,tsconfig.json,next.config.mjs,next-env.d.ts,app/layout.tsx,app/page.tsx,app/providers.tsx,app/actions.ts,app/cart/page.tsx,README.md}`

- [ ] **Step 1: Create `examples/next-app-router/package.json`**

```json
{
  "name": "@viu/emporix-examples-next-app-router",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "typecheck": "tsc --noEmit",
    "test": "echo \"(no tests for example)\" && exit 0",
    "lint": "echo \"(lint skipped for example)\" && exit 0"
  },
  "dependencies": {
    "@tanstack/react-query": "^5.51.0",
    "@viu/emporix-sdk": "workspace:*",
    "@viu/emporix-sdk-react": "workspace:*",
    "next": "^14.2.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: Create `examples/next-app-router/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "lib": ["ES2022", "DOM"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "types": ["node"],
    "noEmit": true,
    "plugins": [{ "name": "next" }],
    "verbatimModuleSyntax": false
  },
  "include": ["next-env.d.ts", "app", ".next/types/**/*.ts"]
}
```

- [ ] **Step 3: Create `examples/next-app-router/next.config.mjs`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = { reactStrictMode: true };
export default nextConfig;
```

- [ ] **Step 4: Create `examples/next-app-router/next-env.d.ts`**

```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />
```

- [ ] **Step 5: Create `examples/next-app-router/app/providers.tsx`**

```tsx
"use client";

import { useState, type ReactNode } from "react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider, createMemoryStorage } from "@viu/emporix-sdk-react";

export function Providers({
  initialCustomerToken,
  children,
}: {
  initialCustomerToken?: string;
  children: ReactNode;
}): React.JSX.Element {
  const [client] = useState(
    () =>
      new EmporixClient({
        tenant: process.env.NEXT_PUBLIC_EMPORIX_TENANT ?? "mytenant",
        credentials: {
          backend: { clientId: "unused-on-client", secret: "unused-on-client" },
          storefront: { clientId: process.env.NEXT_PUBLIC_EMPORIX_STOREFRONT_CLIENT_ID ?? "" },
        },
      }),
  );
  const [queryClient] = useState(() => new QueryClient());
  const [storage] = useState(() =>
    createMemoryStorage(initialCustomerToken ? { initial: initialCustomerToken } : {}),
  );
  return (
    <EmporixProvider client={client} queryClient={queryClient} storage={storage}>
      {children}
    </EmporixProvider>
  );
}
```

- [ ] **Step 6: Create `examples/next-app-router/app/layout.tsx`**

```tsx
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { Providers } from "./providers";

export const metadata = { title: "Emporix SDK — Next App Router example" };

export default function RootLayout({ children }: { children: ReactNode }): React.JSX.Element {
  const token = cookies().get("emporix.customerToken")?.value;
  return (
    <html lang="en">
      <body>
        <Providers initialCustomerToken={token}>{children}</Providers>
      </body>
    </html>
  );
}
```

- [ ] **Step 7: Create `examples/next-app-router/app/page.tsx`**

```tsx
import { EmporixClient, auth } from "@viu/emporix-sdk";

// Server Component: read the catalog directly with the SDK (one client/server).
const sdk = new EmporixClient({
  tenant: process.env.NEXT_PUBLIC_EMPORIX_TENANT ?? "mytenant",
  credentials: {
    backend: {
      clientId: process.env.EMPORIX_BACKEND_CLIENT_ID ?? "",
      secret: process.env.EMPORIX_BACKEND_CLIENT_SECRET ?? "",
    },
    storefront: { clientId: process.env.EMPORIX_STOREFRONT_CLIENT_ID ?? "" },
  },
  logger: false,
});

export default async function Page(): Promise<React.JSX.Element> {
  const page = await sdk.products.list({ pageSize: 12 }, auth.anonymous());
  return (
    <main>
      <h1>Catalog (RSC)</h1>
      <ul>
        {page.items.map((p) => (
          <li key={p.id}>{p.name ?? p.id}</li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 8: Create `examples/next-app-router/app/actions.ts`**

```ts
"use server";

import { cookies } from "next/headers";
import { EmporixClient } from "@viu/emporix-sdk";

const sdk = new EmporixClient({
  tenant: process.env.NEXT_PUBLIC_EMPORIX_TENANT ?? "mytenant",
  credentials: {
    backend: { clientId: "unused", secret: "unused" },
    storefront: { clientId: process.env.EMPORIX_STOREFRONT_CLIENT_ID ?? "" },
  },
  logger: false,
});

/** Logs the customer in and stores the token in an httpOnly cookie. */
export async function loginAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email"));
  const password = String(formData.get("password"));
  const session = await sdk.customers.login({ email, password });
  cookies().set("emporix.customerToken", session.customerToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
  });
}
```

- [ ] **Step 9: Create `examples/next-app-router/app/cart/page.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useCart, useCartMutations } from "@viu/emporix-sdk-react";

export default function CartPage(): React.JSX.Element {
  const [cartId, setCartId] = useState<string | undefined>(undefined);
  const cart = useCart(cartId);
  const { addItem } = useCartMutations(cartId ?? "");
  return (
    <main>
      <h1>Cart</h1>
      <input
        placeholder="cart id"
        onChange={(e) => setCartId(e.target.value || undefined)}
      />
      <p>{cart.data ? `${cart.data.items.length} items` : "no cart"}</p>
      <button
        disabled={!cartId}
        onClick={() => addItem.mutate({ productId: "demo", quantity: 1 })}
      >
        Add demo item
      </button>
    </main>
  );
}
```

- [ ] **Step 10: Create `examples/next-app-router/README.md`**

```md
# Emporix SDK — Next.js App Router example

Next.js 14 App Router: RSC catalog (SDK called directly on the server),
client-side cart hooks, and a customer login Server Action that sets an
httpOnly cookie hydrated into the provider via `initialCustomerToken`.

## Run

\`\`\`bash
NEXT_PUBLIC_EMPORIX_TENANT=mytenant NEXT_PUBLIC_EMPORIX_STOREFRONT_CLIENT_ID=xxx \
  pnpm --filter @viu/emporix-examples-next-app-router dev
\`\`\`

`pnpm --filter @viu/emporix-examples-next-app-router build` runs `next build`
(needs the full Next toolchain; not part of the library CI gate).
```

- [ ] **Step 11: Install + typecheck**

Run: `pnpm install`
Run: `pnpm --filter @viu/emporix-sdk build && pnpm --filter @viu/emporix-sdk-react build`
Run: `pnpm --filter @viu/emporix-examples-next-app-router typecheck`
Expected: PASS. (If `tsc` cannot find `.next/types/**`, that glob is optional —
it only exists after `next build`; the `include` tolerates its absence.)

- [ ] **Step 12: Commit**

```bash
git add examples/next-app-router pnpm-lock.yaml
git commit -m "feat(examples): add next-app-router example"
```

---

## Task 4: Documentation + final verification + changeset

**Files:**
- Create/overwrite: `README.md`, `packages/sdk/README.md`, `packages/react/README.md`, `CONTRIBUTING.md`, `docs/logging.md`, `docs/auth.md`, `docs/react.md`, `.changeset/examples-docs.md`

- [ ] **Step 1: Write root `README.md`**

Content must cover: monorepo overview; package table (`@viu/emporix-sdk`,
`@viu/emporix-sdk-react`, examples); install; the two-PR Changesets release
model (push with changesets → "Version Packages" PR → merge → publish);
links to `packages/*/README.md`, `CONTRIBUTING.md`, and `docs/*`.

- [ ] **Step 2: Write `packages/sdk/README.md`**

Content: install; quick start (`new EmporixClient(...)`, anonymous browse,
login, customer call, `auth.service('partner')`, `auth.raw(jwt)`); config table
(tenant, host, credentials.backend/storefront/custom, timeouts, retry, cache,
logger, tokenProvider); an `AuthContext`-per-method table (which token kind each
service method defaults to / requires); logging guide pointer to `docs/logging.md`.

- [ ] **Step 3: Write `packages/react/README.md`**

Content: install (peer deps); `EmporixProvider` setup; hook reference
(`useCustomerSession`, query hooks, `useCartMutations`); storage adapters;
SSR pointer to `docs/react.md`.

- [ ] **Step 4: Write `CONTRIBUTING.md`**

Content: Conventional Commits format + allowed scopes (from
`commitlint.config.js`); husky hooks (pre-commit lint+typecheck, commit-msg);
**when and how to run `pnpm changeset`** with three worked examples — sdk-only,
react-only, both-packages — including a sample changeset file; when to use the
`no-release` PR label; the pre-release (`next` dist-tag) flow; the two-PR
release model.

- [ ] **Step 5: Write `docs/logging.md`**

Content: levels and semantics; per-service resolution chain
(`EMPORIX_LOG_LEVEL_<SVC>` > `EMPORIX_LOG_LEVEL` > `config.services` >
`config.level` > `warn`); env-var reference; runtime `setLogLevel`/`getLogLevel`
(env-sticky unless `force`); redaction policy; pino and winston adapter recipes
(documented code, not shipped).

- [ ] **Step 6: Write `docs/auth.md`**

Content: the four token kinds; `service`/`anonymous` SDK-managed vs
`customer`/`raw` caller-managed; the anonymous→login→merge `sessionId` flow and
why `customers.login` threads the anonymous token; per-method default table;
custom credential sets; SSO/token-exchange via `raw` or an injected
`TokenProvider`; the 401 asymmetry.

- [ ] **Step 7: Write `docs/react.md`**

Content: provider setup; storage adapter trade-offs (memory/localStorage/cookie
+ CSRF note); SSR patterns (RSC direct SDK calls + `prefetchProduct`/
`prefetchCart` + `initialCustomerToken`; client-once-per-server rule); common
pitfalls (per-request client, token hydration, cart-merge timing).

- [ ] **Step 8: Full verification (mirrors CI)**

Run: `pnpm typecheck`
Expected: PASS repo-wide (all packages + examples typecheck).
Run: `pnpm test`
Expected: PASS (packages: sdk + react suites green).
Run: `pnpm build`
Expected: PASS (packages built; examples excluded from the scoped script).
Run: `pnpm changeset status --since=HEAD`
Expected: no config error; examples ignored.

- [ ] **Step 9: Create `.changeset/examples-docs.md`**

```md
---
"@viu/emporix-sdk": patch
---

Add documentation (root + package READMEs, CONTRIBUTING, docs/logging,
docs/auth, docs/react) and runnable examples (node-server, vite-spa,
next-app-router). No API changes.
```

> Only a `patch` for `@viu/emporix-sdk` (docs touch the published package's
> README). Examples are private and ignored by Changesets.

- [ ] **Step 10: Commit**

```bash
git add README.md packages/sdk/README.md packages/react/README.md CONTRIBUTING.md docs .changeset/examples-docs.md
git commit -m "docs: add READMEs, CONTRIBUTING and logging/auth/react guides"
```

---

## Self-Review

**Spec coverage (§10 docs, §12 examples; milestones 15–18):**
- M15 next-app-router runnable (RSC catalog, client cart, login Server Action →
  httpOnly cookie → `initialCustomerToken`): Task 3. SSR helpers themselves
  shipped in Plan 3. ✓
- M16 vite-spa runnable (CSR, localStorage token, react-router, login flow):
  Task 2. ✓
- M17 node-server runnable (no React, catalog/listAll, service context):
  Task 1. ✓
- M18 docs: root README (two-PR release), per-package READMEs, CONTRIBUTING
  (changesets workflow with sdk/react/both examples + no-release + pre-release),
  `docs/logging.md`/`docs/auth.md`/`docs/react.md`: Task 4. ✓
- Carried deviation resolved: `.changeset` `ignore: ["@viu/emporix-examples-*"]`
  re-added once a matching package exists (Task 1 Step 6), verified Step 7. ✓

**Placeholder scan:** Doc tasks (Task 4 Steps 1–7) specify required *content*
per file rather than literal prose — these are documentation deliverables, not
code; the content checklist is the spec. No TBD/TODO. Example code blocks are
complete and self-contained.

**Type consistency:** Examples consume only published exports — `EmporixClient`,
`auth`, `EmporixProvider`, `createMemoryStorage`/`createLocalStorageStorage`,
`useProducts`/`useCustomerSession`/`useCart`/`useCartMutations` — all matching
Plan 2/3 public APIs. Example package names all match the
`@viu/emporix-examples-*` glob used by the Changesets `ignore`. Root script
scoping (`./packages/*`) keeps `@viu/emporix-sdk` + `@viu/emporix-sdk-react` in
the release gate; examples excluded from build/test/lint but covered by
repo-wide `typecheck`.
