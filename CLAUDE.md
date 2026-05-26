# CLAUDE.md

Repo-wide conventions for Claude / agentic workflows. Read me at session start.

## What this is

A TypeScript SDK and React bindings for the Emporix Commerce Engine. Published as `@viu/emporix-sdk` and `@viu/emporix-sdk-react` on npm. The `viu` tenant is the primary internal consumer; external storefronts can use it via the public packages.

## Workspace layout

| Path | Purpose | Released? |
|---|---|---|
| `packages/sdk` | Core SDK: HTTP, auth, services (Product, Category, Cart, Checkout, Customer, Payment, Price, Media, Segment, Site, SessionContext, Companies, Contacts, Locations, CustomerGroups) | yes (`@viu/emporix-sdk`) |
| `packages/react` | React-Query bindings: hooks, provider, storage adapters | yes (`@viu/emporix-sdk-react`) |
| `examples/vite-spa` | Reference storefront (Vite + React Router) | no |
| `examples/next-app-router` | Reference storefront (Next.js App Router) | no |
| `examples/node-server` | Plain Node consumer (no React) | no |
| `e2e/` | Playwright end-to-end suite against the `viu` tenant | no |
| `docs/` | Public docs (`auth.md`, `react.md`, `pagination.md`, `e2e.md`, ...) + design docs under `docs/superpowers/{specs,plans}/` | n/a |

## Commands you'll use constantly

| Command | Purpose |
|---|---|
| `pnpm install` | bootstrap workspace |
| `pnpm -r build` | build every package (writes `dist/`) |
| `pnpm -r test` | run all unit tests (Vitest + MSW) |
| `pnpm typecheck` | repo-wide tsc |
| `pnpm e2e` | run Playwright e2e against `viu` (needs `e2e/.env.local`) |
| `pnpm changeset` | author a release entry |
| `pnpm -F <pkg> <script>` | run a script in one package only |

## Commitlint rules (enforced by husky)

- **Allowed scopes** (one of): `repo, release, sdk, react, core, customer, product, category, cart, checkout, payment, price, media, segment, auth, http, logger, deps, docs, examples`.
- **First word after the scope must be lowercase verb**. `feat(react): add useCreateCart` ✓ — `feat(react): Add useCreateCart` ✗ (sentence-case rejected). Names like `CLAUDE.md` in the subject also trip the check; rephrase to `add claude.md` or similar.
- Source: `commitlint.config.js` + `.husky/commit-msg`.

## Branching + release flow

1. Feature work goes on `feat/<short-name>`, fixes on `fix/<short-name>`.
2. Author a changeset (`pnpm changeset`) describing the user-visible effect — that file goes in `.changeset/`.
3. Open a PR against `main`. Pre-commit runs typecheck + lint; CI (`changeset-check.yml`) verifies the changeset.
4. Merge to `main` → `changesets/action` (in `.github/workflows/release.yml`) opens a release PR that bumps versions + updates CHANGELOGs.
5. Merging that release PR triggers the actual `npm publish` (requires `NPM_TOKEN` repo secret).
6. `@viu/emporix-examples-*` are listed under `.changeset/config.json` `ignore` — they are not versioned or published.

## Test architecture

- **Unit tests** (Vitest, `jsdom` env in React) — `packages/sdk/tests/`, `packages/react/tests/`. HTTP mocked with MSW. `pnpm -r test`.
- **E2E tests** (Playwright + Chromium) — `e2e/specs/`. Boots `examples/vite-spa` via `webServer` in `playwright.config.ts`, hits the real `viu` tenant. Some specs need `EMPORIX_TEST_CUSTOMER_EMAIL/_PASSWORD` (via `e2e/.env.local`); without them they skip cleanly. `pnpm e2e`.
- Chrome DevTools MCP is the interactive-debug fallback if Playwright Agent CLI is unavailable; see `docs/e2e.md`.

## Things that are easy to get wrong

- `client.carts.getCurrent(...)` returns a `Cart` with `.id`. `client.carts.create(...)` returns `CartCreated` with `.cartId`. The two shapes are not interchangeable.
- `useCheckout` auto-detects auth (customer if a token is stored, anonymous otherwise). `usePaymentModes` is intentionally customer-only — its helper `customerOnlyCtx` throws on missing token.
- `client.carts.merge(customerCartId, [anonCartId], auth)` — the path-ID is the **customer** cart (target), the body lists anonymous cart IDs to merge in. Easy to invert.
- `EmporixStorage` keys: `emporix.customerToken`, `emporix.cartId`, `emporix.anonymousSession`, `emporix.siteCode`, `emporix.activeLegalEntityId`, `emporix.refreshToken`. The `anonymousSession` carries `{ refreshToken, sessionId }` and is what makes the guest cart survive page reloads (PR #26). The `refreshToken` is mirrored from the customer session and is needed for B2B refresh-on-switch — without it, `setActiveCompany` falls back to local-state-only.
- Examples typecheck against the built `dist/` of `@viu/emporix-sdk` and `@viu/emporix-sdk-react`. Run `pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build` before `pnpm -F @viu/emporix-examples-* typecheck` if you've changed SDK/React source.

## When you're not sure

Read `docs/auth.md`, `docs/react.md`, `docs/b2b.md`, `docs/checkout.md`, `docs/e2e.md`, `docs/pagination.md`. Design specs and implementation plans live under `docs/superpowers/specs/` and `docs/superpowers/plans/` respectively. The most recent specs are the closest to today's behavior.
