# Next Example Migration + Next 16 Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `examples/next-app-router`'s four server-side files onto `@viu/emporix-sdk-next`, and in the process make the package target Next 16 — the current stable, which its `^15.0.0` peer range excluded.

**Architecture:** Three changes to the package (Next 16 peer, two-argument `revalidateTag`, a `context` option), then the example consumes them. The example is the acceptance test: three module-scope `EmporixClient` instances become zero, and a real `next build` against the `viu` tenant is the proof.

**Tech Stack:** Next 16.2.12 (Turbopack by default), React 19.2.7, TypeScript 5.6, Vitest 2, tsup 8, Changesets.

**Spec:** [`../specs/2026-07-31-next-example-migration-design.md`](../specs/2026-07-31-next-example-migration-design.md)

## Global Constraints

- **This must merge before release PR [#183](https://github.com/viuteam/emporix-sdk/pull/183).** `.changeset/emporix-sdk-next-initial.md` is still unconsumed on `main`, so every API change here lands as part of 0.1.0 rather than a follow-up minor. The window closes when #183 merges.
- **Amend `.changeset/emporix-sdk-next-initial.md`. Do NOT add a second changeset** for `@viu/emporix-sdk-next` — 0.1.0 has not shipped, so a second entry would imply a version that never existed.
- **Example packages need no changeset** — `.changeset/config.json` has `ignore: ["@viu/emporix-examples-*"]`.
- **Peer becomes `next: "^16.0.0"`.** Next 15 is deliberately dropped. Do not build an arity-sniffing compatibility shim; the package's eslint sets `@typescript-eslint/no-explicit-any: "error"` and there are no consumers to preserve.
- **`revalidateTag`'s default second argument is `{ expire: 0 }`, not `"max"`.** The Next docs prescribe immediate expiry for webhook-driven invalidation; serving stale prices or stale availability after an explicit Emporix event is the wrong trade-off.
- **Credentials never enter the repo.** The `viu` tenant values live only in `examples/next-app-router/.env.local`, which `.gitignore:7` (`.env.*`) covers — verified with `git check-ignore -v`. Never hardcode them in source, never commit them, never echo them to the terminal.
- **`tsconfig.base.json` strictness that bites:** `exactOptionalPropertyTypes: true` (use `...(v !== undefined ? { v } : {})`), `noUncheckedIndexedAccess: true`, `verbatimModuleSyntax: true` (type-only imports need `import type`).
- **Commitlint scopes:** `repo, release, sdk, react, core, customer, product, category, cart, checkout, payment, price, media, segment, availability, auth, http, logger, deps, docs, examples`. Use `examples` for example changes and `repo` for package changes. First word after the scope must be a lowercase verb.
- **Branch:** `feat/migrate-next-example`, which already carries the spec commits.
- **Gates per task:** `pnpm -F @viu/emporix-sdk-next test`, `pnpm -F @viu/emporix-sdk-next typecheck`, `pnpm -F @viu/emporix-sdk-next lint`. Before the final commit: `pnpm -r test && pnpm typecheck && pnpm lint`.

---

## File Structure

| File | Change | Task |
|---|---|---|
| `packages/next/package.json` | peer `next: "^16.0.0"`, devDep `next: "^16.2.12"` | 1 |
| `packages/next/src/webhook.ts` | `revalidateTag(tag, profile)`, new `profile` option | 1 |
| `packages/next/tests/webhook.test.ts` | mock accepts two args; assert the profile | 1 |
| `packages/next/src/client.ts` | `context` option + memoization key | 2 |
| `packages/next/tests/client.test.ts` | two new context cases | 2 |
| `examples/next-app-router/package.json` | `next: "^16.2.12"`, add `@viu/emporix-sdk-next` | 3 |
| `examples/next-app-router/app/emporix.ts` | **new** — maps this app's `NEXT_PUBLIC_*` names onto the factory | 3 |
| `examples/next-app-router/app/layout.tsx` | `emporixSession()` instead of a hand-read cookie | 3 |
| `examples/next-app-router/app/page.tsx` | `emporix()`; backend credentials deleted | 3 |
| `examples/next-app-router/app/actions.ts` | `emporix({ tagged: false })` + `emporixSessionMutable()` | 3 |
| `examples/next-app-router/app/product/[id]/page.tsx` | `emporix()`; context from the shared mapper | 3 |
| `examples/next-app-router/README.md` | env vars, Next 16 note | 4 |
| `packages/next/README.md` | backend-credentials boundary, `NEXT_PUBLIC_` note, Next 16, profile | 4 |
| `.changeset/emporix-sdk-next-initial.md` | **amended**, not supplemented | 4 |

Untouched, and deliberately so: `app/providers.tsx`, `app/cart/page.tsx`, `app/checkout/page.tsx`, `app/guest-checkout/page.tsx`, `app/product/[id]/product-detail.tsx`. All Client Components. If a step makes you want to edit one of these, stop — the package boundary would be wrong.

---

## Task 1: Next 16 support

**Files:**
- Modify: `packages/next/package.json` (peer + devDep)
- Modify: `packages/next/src/webhook.ts:145-147` (the `revalidateTag` loop) and the options interface
- Test: `packages/next/tests/webhook.test.ts`

**Interfaces:**
- Produces:
  ```ts
  /** Second argument to `revalidateTag`. Default `{ expire: 0 }`. */
  type RevalidateProfile = string | { expire?: number };
  // createEmporixWebhookRoute gains:  profile?: RevalidateProfile
  ```
  Consumed by Task 4's README and changeset.

- [ ] **Step 1: Install Next 16 in the package**

Edit `packages/next/package.json`:

```json
  "peerDependencies": {
    "@viu/emporix-sdk": "workspace:^",
    "@viu/emporix-sdk-react": "workspace:^",
    "next": "^16.0.0"
  },
```

and in `devDependencies`, `"next": "^15.5.19"` → `"next": "^16.2.12"`.

Run: `pnpm install`
Expected: installs. `next@16` peers on `react ^18.2.0 || ^19.0.0`, and the workspace is on 19.2.7, so no React change is needed.

- [ ] **Step 2: Confirm the old call is now a type error**

Run: `pnpm -F @viu/emporix-sdk-next typecheck`
Expected: **FAIL** on `src/webhook.ts` around line 146 — `revalidateTag` now expects 2 arguments.

This failure is the point of the task. If typecheck passes here, the Next 16 types did not install; check that `packages/next/node_modules/next/package.json` reports a 16.x version before continuing.

- [ ] **Step 3: Update the test to the two-argument signature**

In `packages/next/tests/webhook.test.ts`, replace the mock so it records both arguments:

```ts
const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({
  revalidateTag: (tag: string, profile: unknown) => revalidateTag(tag, profile),
}));
```

The existing assertions use `revalidateTag.mock.calls.flat()`, which would now flatten the profile into the array too. Change the three that assert tags to read the first argument only:

```ts
const tagsOf = (): string[] => revalidateTag.mock.calls.map((c) => c[0] as string);
```

- `"revalidates the product tags on a valid product.updated"` → `expect(tagsOf()).toEqual(["emporix:product:p1", "emporix:products"])`
- `"maps category and price events too"` → same substitution for both assertions
- `"falls back to the collection tag when the payload carries no id"` → `expect(tagsOf()).toEqual(["emporix:products"])`

Then add two new cases:

```ts
it("passes { expire: 0 } as the default profile — immediate expiry for webhooks", async () => {
  const route = createEmporixWebhookRoute({ secret: SECRET });

  await route(req(PRODUCT_UPDATED));

  expect(revalidateTag.mock.calls[0]?.[1]).toEqual({ expire: 0 });
});

it("honours a custom profile", async () => {
  const route = createEmporixWebhookRoute({ secret: SECRET, profile: "max" });

  await route(req(PRODUCT_UPDATED));

  for (const call of revalidateTag.mock.calls) {
    expect(call[1]).toBe("max");
  }
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm -F @viu/emporix-sdk-next exec vitest run tests/webhook.test.ts`
Expected: the two new cases FAIL — the profile argument is `undefined` because the source still passes one argument.

- [ ] **Step 5: Implement the two-argument call**

In `packages/next/src/webhook.ts`, add above `createEmporixWebhookRoute`:

```ts
/**
 * The second argument to `revalidateTag`, mandatory since Next 16.
 *
 * `{ expire: 0 }` expires immediately; the next request to a tagged resource is
 * a blocking revalidate. `"max"` (or another `cacheLife` profile) instead marks
 * the tag stale and serves stale content while refreshing in the background.
 */
export type RevalidateProfile = string | { expire?: number };
```

Add to the options object of `createEmporixWebhookRoute`:

```ts
  /**
   * Second argument passed to `revalidateTag`. Defaults to `{ expire: 0 }` —
   * what the Next docs prescribe for webhooks and third-party services that
   * need immediate expiration. Pass `"max"` for stale-while-revalidate, which
   * keeps serving the old response until a page using the tag is next visited.
   */
  profile?: RevalidateProfile;
```

And replace the loop at lines 145–147:

```ts
    const profile: RevalidateProfile = opts.profile ?? { expire: 0 };
    for (const tag of tagsForEvent(event)) {
      revalidateTag(tag, profile);
    }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm -F @viu/emporix-sdk-next exec vitest run tests/webhook.test.ts`
Expected: PASS, 25 tests (23 before plus 2 new).

- [ ] **Step 7: Gates**

Run: `pnpm -F @viu/emporix-sdk-next test && pnpm -F @viu/emporix-sdk-next typecheck && pnpm -F @viu/emporix-sdk-next lint && pnpm -F @viu/emporix-sdk-next build`
Expected: all clean; `dist/webhook.d.ts` now exports `RevalidateProfile`.

- [ ] **Step 8: Commit**

```bash
git add packages/next/package.json packages/next/src/webhook.ts \
        packages/next/tests/webhook.test.ts pnpm-lock.yaml
git commit -m "feat(repo): target next 16 in emporix-sdk-next

npm's latest is 16.2.12, which the previous ^15.0.0 peer range excluded — every
new storefront would have hit a peer conflict on install.

Next 16 made revalidateTag's second cacheLife argument mandatory, so the package
was Next-15-only in fact, not just in declaration. Default profile is
{ expire: 0 }, which the Next docs prescribe for webhook-driven invalidation;
\"max\" would keep serving stale prices until a page using the tag is visited."
```

---

## Task 2: The `context` option

**Files:**
- Modify: `packages/next/src/client.ts` (options interface, memoization key, client construction)
- Test: `packages/next/tests/client.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface GetEmporixClientOptions {
    tenant?: string;
    clientId?: string;
    host?: string;
    tagged?: boolean;
    revalidate?: number;
    context?: {
      currency?: string;
      siteCode?: string;
      targetLocation?: string;
      language?: string;
    };
  }
  ```
  Consumed by Task 3's `app/emporix.ts`.

- [ ] **Step 1: Write the failing tests**

Append to the `describe("getEmporixClient", …)` block in `packages/next/tests/client.test.ts`:

```ts
  it("keys on context, so two contexts are two clients", () => {
    const a = getEmporixClient({ context: { siteCode: "main" } });
    const b = getEmporixClient({ context: { siteCode: "other" } });
    expect(a).not.toBe(b);
    // Same context returns the same instance.
    expect(getEmporixClient({ context: { siteCode: "main" } })).toBe(a);
    // No context is distinct from any context.
    expect(getEmporixClient()).not.toBe(a);
  });

  it("binds the context onto the storefront credentials", () => {
    const sdk = getEmporixClient({ context: { siteCode: "main", currency: "CHF" } });
    expect(sdk.config.credentials.storefront?.context).toEqual({
      siteCode: "main",
      currency: "CHF",
    });
  });
```

`EmporixClient` exposes `readonly config: ResolvedConfig` (`packages/sdk/src/client.ts:117`), and `StorefrontCredentials.context` is a documented field (`packages/sdk/src/core/config.ts:21-26`) — verified, so the second test reads the binding through public surface rather than reaching into a private field.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -F @viu/emporix-sdk-next exec vitest run tests/client.test.ts`
Expected: FAIL — `context` is not a known property of `GetEmporixClientOptions`, and the storefront credentials carry no context.

- [ ] **Step 3: Add the option**

In `packages/next/src/client.ts`, add to `GetEmporixClientOptions` after `revalidate`:

```ts
  /**
   * Storefront request context, bound at anonymous login. Needed for
   * `prices.matchByContext`, and for prefetch-key parity with the client-side
   * `EmporixProvider` — the provider binds the same values, and a mismatch
   * turns a hydration cache hit into a miss.
   */
  context?: {
    currency?: string;
    siteCode?: string;
    targetLocation?: string;
    language?: string;
  };
```

Extend the memoization key:

```ts
  const key = `${tenant}|${clientId}|${host ?? ""}|${tagged}|${revalidate}|${JSON.stringify(opts.context ?? {})}`;
```

`JSON.stringify` is key-order-dependent, so the same context written with fields in a different order yields a second client instance. That is wasteful rather than wrong, and the context is written once per app in one place — sorting the keys would optimise a case that does not occur.

And bind it when constructing:

```ts
  const client = new EmporixClient({
    tenant,
    credentials: {
      storefront: {
        clientId,
        ...(opts.context !== undefined ? { context: opts.context } : {}),
      },
    },
    logger: false,
    ...(host !== undefined ? { host } : {}),
    ...(tagged ? { fetch: createTaggingFetch({ tenant, revalidate }) } : {}),
  });
```

The conditional spread is required by `exactOptionalPropertyTypes`.

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm -F @viu/emporix-sdk-next exec vitest run tests/client.test.ts`
Expected: PASS, 15 tests (13 before plus 2 new).

- [ ] **Step 5: Gates and commit**

Run: `pnpm -F @viu/emporix-sdk-next test && pnpm -F @viu/emporix-sdk-next typecheck && pnpm -F @viu/emporix-sdk-next lint`

```bash
git add packages/next/src/client.ts packages/next/tests/client.test.ts
git commit -m "feat(repo): add a context option to getEmporixClient

Found by migrating examples/next-app-router: the product page binds
credentials.storefront.context = { siteCode }, and the factory had no way to
express it. Migrating naively would have silently dropped the binding and turned
the page's hydration cache hit into a miss.

currency and siteCode are baseline storefront configuration, contain no secret,
and are fully covered by the memoization key."
```

---

## Task 3: Upgrade and migrate the example

**Files:**
- Modify: `examples/next-app-router/package.json`
- Create: `examples/next-app-router/app/emporix.ts`
- Modify: `examples/next-app-router/app/layout.tsx`, `app/page.tsx`, `app/actions.ts`, `app/product/[id]/page.tsx`

**Interfaces:**
- Consumes: `getEmporixClient` + `context` (Task 2), `emporixSession`, `emporixSessionMutable` (already shipped), `prefetchProduct` from `@viu/emporix-sdk-react/ssr`.
- Produces: `emporix(opts?)` and `SITE_CODE` from `app/emporix.ts`, used by three pages and one action.

- [ ] **Step 1: Add the dependency and bump Next**

In `examples/next-app-router/package.json`, add to `dependencies`:

```json
    "@viu/emporix-sdk-next": "workspace:*",
```

and change `"next": "^15.5.19"` → `"next": "^16.2.12"`.

Run: `pnpm install`
Expected: installs cleanly. React stays at 19.2.7 — Next 16.2.12 peers on `react ^18.2.0 || ^19.0.0`.

- [ ] **Step 2: Create the env-name mapper**

`examples/next-app-router/app/emporix.ts`:

```ts
import { getEmporixClient, type GetEmporixClientOptions } from "@viu/emporix-sdk-next";
import type { EmporixClient } from "@viu/emporix-sdk";

/** Bound on every server-side client so prefetch keys match what the provider binds. */
export const SITE_CODE = "main";

/**
 * Maps this app's `NEXT_PUBLIC_*` environment names onto the package factory.
 *
 * The `NEXT_PUBLIC_` prefix is required because `app/providers.tsx` is a Client
 * Component and reads the same values in the browser; the package's own defaults
 * (`EMPORIX_TENANT`, `EMPORIX_STOREFRONT_CLIENT_ID`) are server-only names, so
 * they are passed explicitly here instead.
 */
export function emporix(opts: GetEmporixClientOptions = {}): EmporixClient {
  return getEmporixClient({
    tenant: process.env.NEXT_PUBLIC_EMPORIX_TENANT ?? "mytenant",
    clientId: process.env.NEXT_PUBLIC_EMPORIX_STOREFRONT_CLIENT_ID ?? "",
    context: { siteCode: SITE_CODE, currency: "CHF" },
    ...opts,
  });
}
```

- [ ] **Step 3: Migrate `app/layout.tsx`**

Replace the cookie read. Before:

```tsx
import { cookies } from "next/headers";
…
  // Next 15: `cookies()` is async.
  const token = (await cookies()).get("emporix.customerToken")?.value;
  const providerProps = token !== undefined ? { initialCustomerToken: token } : {};
```

After — drop the `next/headers` import entirely:

```tsx
import { emporixSession } from "@viu/emporix-sdk-next";
…
  // Read-only session: a Server Component may not write cookies.
  const { customerToken } = await emporixSession();
  const providerProps = customerToken !== null ? { initialCustomerToken: customerToken } : {};
```

Note the null check changes from `!== undefined` to `!== null` — `emporixSession` normalises a missing cookie to `null`.

- [ ] **Step 4: Migrate `app/page.tsx`**

Delete the module-scope client entirely — including its `EmporixClient` import and both backend-credential env reads, which nothing used — and resolve the client inside the component:

```tsx
import { auth } from "@viu/emporix-sdk";
import { emporix } from "./emporix";

// … displayName() stays exactly as it is …

export default async function Page(): Promise<React.JSX.Element> {
  // Memoized per process by getEmporixClient — never a client per request.
  const sdk = emporix();
  const page = await sdk.products.list({ pageSize: 12 }, auth.anonymous());
  return (
    <main>
      <h1>Catalog (RSC)</h1>
      <ul>
        {page.items.map((p) => (
          <li key={p.id}>{displayName(p.name, p.id ?? "")}</li>
        ))}
      </ul>
    </main>
  );
}
```

This GET is now tagged `emporix:products` automatically.

- [ ] **Step 5: Migrate `app/actions.ts`**

Replace the whole file:

```ts
"use server";

import { emporixSessionMutable } from "@viu/emporix-sdk-next";
import { emporix } from "./emporix";

/** Logs the customer in and stores the token in an httpOnly cookie. */
export async function loginAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email"));
  const password = String(formData.get("password"));
  // Untagged: anything touching a customer token must not go through the
  // tagged client. (The login POST is untaggable anyway — this is the habit.)
  const session = await emporix({ tagged: false }).customers.login({ email, password });
  // httpOnly, secure, sameSite=lax, path=/ are the defaults.
  const { storage } = await emporixSessionMutable();
  storage.setCustomerToken(session.customerToken);
}
```

The hand-written cookie name and attributes are gone; both now come from the package.

- [ ] **Step 6: Migrate `app/product/[id]/page.tsx`**

Delete the module-scope client and the local `SITE_CODE`, taking both from the mapper:

```tsx
import { QueryClient, dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { prefetchProduct } from "@viu/emporix-sdk-react/ssr";
import { emporix, SITE_CODE } from "../../emporix";
import { ProductDetail } from "./product-detail";

// Server Component: prefetch with the SDK, hand the dehydrated cache to the
// client. The prefetch key must match useProduct's key for hydration to be a
// cache hit — so the same siteCode the provider binds is passed here, and
// app/emporix.ts is the single place both read it from. language is unbound on
// both sides (null), so it is omitted.

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const qc = new QueryClient();
  await prefetchProduct(qc, emporix(), id, undefined, { siteCode: SITE_CODE });
  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <ProductDetail productId={id} />
    </HydrationBoundary>
  );
}
```

- [ ] **Step 7: Verify no module-scope clients survive**

Run: `grep -rn 'new EmporixClient' examples/next-app-router/app`
Expected: **one** hit only — `app/providers.tsx`, which is a Client Component and constructs the browser-side client. Zero hits in server files.

Run: `grep -rn 'emporix\.customerToken\|EMPORIX_BACKEND' examples/next-app-router/app`
Expected: no output. The cookie-name literal and the unused backend credentials are gone.

- [ ] **Step 8: Typecheck against the built package**

Run: `pnpm -F @viu/emporix-sdk-next build && pnpm typecheck`
Expected: clean. The example typechecks against `packages/next/dist`, so the build must come first.

- [ ] **Step 9: The acceptance test — a real `next build`**

Create `examples/next-app-router/.env.local` with the `viu` tenant values supplied in this session:

```
NEXT_PUBLIC_EMPORIX_TENANT=viu
NEXT_PUBLIC_EMPORIX_STOREFRONT_CLIENT_ID=<the storefront client id>
```

The client id is deliberately not written into this plan. `.gitignore:7` (`.env.*`) covers the file — confirm with `git check-ignore -v examples/next-app-router/.env.local` before writing it, and never echo its contents.

Run: `pnpm -F @viu/emporix-examples-next-app-router exec next build`

Expected: a successful build. Next 16 uses Turbopack by default and the example has no webpack config, so no `--webpack` flag is needed.

**Read the outcome carefully and report it precisely:**

- **Compile + typecheck phase fails** → a real migration failure. Fix the source.
- **Static generation fails** on an Emporix HTTP error (401/403, or a network error) → **not** a migration failure. The compile phase already passed, which is the part this task can prove. Say exactly that; do not report the build as green, and do not report it as a migration failure either.
- Build succeeds → the migration is verified end to end.

`next build` is not part of CI: `pr-check.yml` builds packages only, and the example's `build` script is excluded from the release gate. This step is the only place it runs.

- [ ] **Step 10: Commit**

```bash
git add examples/next-app-router/package.json examples/next-app-router/app pnpm-lock.yaml
git commit -m "feat(examples): migrate next-app-router onto emporix-sdk-next

Three module-scope EmporixClient instances become zero, and app/page.tsx loses
backend credentials it never used — one fewer secret in the example's env
surface.

app/emporix.ts exists because four files each need the tenant and client id, and
the NEXT_PUBLIC_ prefix is required for the Client Component that reads the same
values in the browser. It also fixes a pre-existing split where page.tsx read
EMPORIX_STOREFRONT_CLIENT_ID while providers.tsx read the NEXT_PUBLIC_ one.

Next bumped to 16.2.12. React stays at 19.2.7 — Next 16 peers on ^19.0.0.
Client Components are untouched, which is the boundary working as intended."
```

Do **not** `git add examples/next-app-router/.env.local`. Verify with `git status --short` that it does not appear.

---

## Task 4: Docs, changeset, PR

**Files:**
- Modify: `packages/next/README.md`, `examples/next-app-router/README.md`
- Modify: `.changeset/emporix-sdk-next-initial.md` (amend)

**Interfaces:**
- Consumes: everything from Tasks 1–3.

- [ ] **Step 1: Document the three gaps in `packages/next/README.md`**

Change the install line to state the Next requirement:

```bash
pnpm add @viu/emporix-sdk-next @viu/emporix-sdk @viu/emporix-sdk-react next
```

and add below it:

```markdown
Requires **Next 16**. Next 15 is not supported: Next 16 made `revalidateTag`'s
second `cacheLife` argument mandatory, and bridging both signatures would need a
runtime shim for no benefit.
```

In the *Environment* section, replace the body with:

```markdown
`EMPORIX_TENANT`, `EMPORIX_STOREFRONT_CLIENT_ID`, optionally `EMPORIX_HOST` —
or pass `tenant` / `clientId` / `host` explicitly.

A Next app usually has to pass them explicitly: any value its Client Components
also read needs the `NEXT_PUBLIC_` prefix, and these server-only names do not
carry it. See `examples/next-app-router/app/emporix.ts` for the one-file mapping.

```ts
getEmporixClient({
  tenant: process.env.NEXT_PUBLIC_EMPORIX_TENANT,
  clientId: process.env.NEXT_PUBLIC_EMPORIX_STOREFRONT_CLIENT_ID,
  context: { siteCode: "main", currency: "CHF" },
});
```

`context` is bound at anonymous login. It is needed for
`prices.matchByContext`, and for prefetch-key parity with the client-side
`EmporixProvider` — bind the same values on both sides or hydration is a cache
miss instead of a hit.

### What `getEmporixClient` deliberately cannot do

It only configures **storefront** (anonymous) credentials. There is no option for
a `backend` / service credential set, because a secret does not belong in a
memoized factory where it becomes part of a cache key. Server-side work needing a
`service` AuthContext — `media.*`, for instance — constructs its own client:

```ts
import { createTaggingFetch } from "@viu/emporix-sdk-next";

const sdk = new EmporixClient({
  tenant,
  credentials: { backend: { clientId, secret } },
  fetch: createTaggingFetch({ tenant, revalidate: 3600 }),
});
```
```

In the webhook section, after the `createEmporixWebhookRoute` example, add:

```markdown
`revalidateTag`'s second argument defaults to `{ expire: 0 }` — immediate expiry,
which the Next docs prescribe for webhooks and third-party services calling your
Route Handlers. Pass `profile: "max"` for stale-while-revalidate instead, which
keeps serving the old response until a page using the tag is next visited. For a
price change or a product going out of stock, immediate expiry is usually what
you want.
```

- [ ] **Step 2: Update `examples/next-app-router/README.md`**

Replace its body with:

```markdown
# Emporix SDK — Next.js App Router example

Next.js 16 App Router (React 19): RSC catalog read through
[`@viu/emporix-sdk-next`](../../packages/next), client-side cart hooks, and a
customer login Server Action that writes an httpOnly cookie hydrated into the
provider via `initialCustomerToken`.

Server-side wiring lives in `app/emporix.ts` — one place mapping this app's
`NEXT_PUBLIC_*` names onto `getEmporixClient`. There is no module-scope
`EmporixClient` in any server file; the factory memoizes per process.

```bash
NEXT_PUBLIC_EMPORIX_TENANT=mytenant NEXT_PUBLIC_EMPORIX_STOREFRONT_CLIENT_ID=xxx \
  pnpm --filter @viu/emporix-examples-next-app-router dev
```

Or put both in an untracked `.env.local`.

`pnpm --filter @viu/emporix-examples-next-app-router build` runs `next build`
(Turbopack by default in Next 16; needs the full Next toolchain and reachable
Emporix credentials, since the catalog page fetches during static generation —
not part of the library CI gate).
```

- [ ] **Step 3: Amend the changeset**

In `.changeset/emporix-sdk-next-initial.md`, add `context` to the
`getEmporixClient` bullet and rewrite the webhook bullet's tail. The file keeps
its single `"@viu/emporix-sdk-next": minor` header — do not add a second
changeset.

Add to the `getEmporixClient` bullet:

```markdown
  Accepts `tenant`, `clientId`, `host`, `tagged`, `revalidate` and `context`
  (`currency` / `siteCode` / `targetLocation` / `language`, bound at anonymous
  login and required for prefetch-key parity with the client provider). All six
  are covered by the memoization key.
```

And append a new bullet:

```markdown
- **Requires Next 16.** Next 16 made `revalidateTag`'s second `cacheLife`
  argument mandatory. `createEmporixWebhookRoute` defaults it to `{ expire: 0 }`
  — immediate expiry, which the Next docs prescribe for webhook-driven
  invalidation — and exposes `profile` to choose `"max"` (stale-while-revalidate)
  instead.
```

- [ ] **Step 4: Full repo gates**

Run: `pnpm -r test && pnpm typecheck && pnpm lint && pnpm -r --filter "./packages/*" build`
Expected: all clean. Package test counts: **next 69**, sdk 837, react 343, mixins 42.

The 69 is derived, not guessed: today's 65 is `tags` 22 + `client` 13 + `session` 7 + `webhook` 23. Task 1 takes `webhook` to 25, Task 2 takes `client` to 15 → 22 + 15 + 7 + 25 = 69. Any other number means a test was lost — find out which before moving on.

- [ ] **Step 5: Confirm no credentials leaked**

Run: `git status --short`
Expected: `.env.local` does not appear.

Scan the branch's diff for anything shaped like a credential, without embedding
one in this document:

```bash
git log main..HEAD -p | grep -inE '(CLIENT_ID|SECRET|TOKEN)[ ="'\'':]+[A-Za-z0-9_-]{24,}'
```

Expected: no output. The pattern matches a long opaque value assigned to a
credential-ish name — which is what a leaked storefront client id or secret looks
like — and deliberately contains no fragment of the real value. A hit means a
credential reached a commit: stop, rewrite the history, and do not push.

Also confirm the untracked file never got staged at any point:

```bash
git log main..HEAD --name-only --pretty=format: | sort -u | grep -c 'env'
```

Expected: `0`.

- [ ] **Step 6: Commit, push, open the PR**

```bash
git add packages/next/README.md examples/next-app-router/README.md \
        .changeset/emporix-sdk-next-initial.md
git commit -m "docs(repo): document next 16, the context option and the credentials boundary"
git push origin feat/migrate-next-example
```

The PR body must state: this must merge **before** #183, because the 0.1.0 changeset is amended rather than supplemented; Next 15 is dropped deliberately and why; the `{ expire: 0 }` default and its reasoning; three module-scope clients removed and one secret dropped from the example; and the exact outcome of the `next build` acceptance test, including whether static generation ran.

---

## Follow-ups not in scope

1. Key normalization in `@viu/emporix-sdk-react` — `useAvailability` /
   `useAvailabilities` onto `emporixKey`, and the `prefetchOrder` / `useOrder`
   `authKind` mismatch. Both invalidate consumer caches; bundle with the next
   react minor.
2. Middleware for site/locale detection. In Next 16 that means `proxy.ts`
   exporting a `proxy` function, Node runtime only — `edge` is not supported
   there.
3. `docs/nextjs.md` with the `images.remotePatterns` entry for `next/image`.
4. Share the eight storage-key literals between `storage/cookie-core.ts` and
   `storage/web-storage.ts` in the react package.
