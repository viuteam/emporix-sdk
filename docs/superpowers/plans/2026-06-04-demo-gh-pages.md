# Storefront-Demo → GitHub Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish `examples/storefront-demo` to GitHub Pages, built and deployed entirely from a GitHub Actions pipeline (no committed build artifacts), and strip the viu-specific placeholders so the public demo is tenant-neutral.

**Architecture:** The demo is a runtime-config Vite SPA — tenant + storefront client id are entered on the in-app `SetupScreen` and kept in `localStorage`, so the published bundle contains **no secrets and no tenant binding**. Three changes make it Pages-ready: (1) a configurable Vite `base` + `BrowserRouter basename` + a `404.html` SPA fallback so deep-links work under the `/emporix-sdk/` sub-path; (2) genericize the viu placeholders; (3) a `pages.yml` workflow that uses the official GitHub Pages deploy actions (`configure-pages` → `upload-pages-artifact` → `deploy-pages`) to build in CI and publish the artifact directly — no `gh-pages` branch, no `dist/` in git.

**Tech Stack:** Vite 7, React 19, React Router v6 (`BrowserRouter`), pnpm workspace, GitHub Actions (official Pages deployment).

**Design rationale:** Captured in the conversation of 2026-06-04 (GH Pages chosen over Vercel/Netlify because the demo is static + runtime-configured → low-risk; Vercel remains the option for per-PR previews / the Next.js SSR example). Examples are listed under `.changeset/config.json` `ignore` → **no changeset** is required for any task here.

**Repo facts (verified):**
- Remote: `git@github.com:viuteam/emporix-sdk.git` → project-page URL `https://viuteam.github.io/emporix-sdk/` → base path `/emporix-sdk/`.
- `examples/storefront-demo/vite.config.ts` is currently `export default defineConfig({ plugins: [react()] })` (no `base`).
- `examples/storefront-demo/src/App.tsx:59` renders a bare `<BrowserRouter>`.
- The demo depends on `@viu/emporix-sdk` / `@viu/emporix-sdk-react` as `workspace:*` and resolves them via their built `dist/` → **packages must be built before the demo** (same as `pr-check.yml`).
- CI conventions (`pr-check.yml`): `actions/checkout@v4`, `pnpm/action-setup@v4`, `actions/setup-node@v4` with `cache: pnpm`, `pnpm install --frozen-lockfile`, build packages via `pnpm -r --filter "./packages/*" build`.
- Demo has **no unit tests** (`"test": "echo … exit 0"`) → verification is build + `vite preview`, not Vitest.

**Manual prerequisites (USER, one-time — cannot be done from code):**
1. GitHub → repo **Settings → Pages → Build and deployment → Source = "GitHub Actions"**. Until this is set, the deploy job errors.
2. In the Emporix tenant being demoed: add `https://viuteam.github.io` to the allowed **CORS origins** (and to OAuth **redirect URIs** if the login redirect flow is used), or browser API calls fail. (Tenant-side; not in this repo.)

---

## Task 1: Make the Vite build Pages-ready (base path, router basename, 404 fallback)

**Files:**
- Modify: `examples/storefront-demo/vite.config.ts`
- Modify: `examples/storefront-demo/src/App.tsx:59` (the `<BrowserRouter>` open tag)

This task is independent and self-contained: after it, `pnpm build` still works locally (base `/`), and a `VITE_BASE=/emporix-sdk/` build produces correctly-prefixed assets + a `404.html`.

- [ ] **Step 1: Replace `vite.config.ts` with an env-driven base + a 404 SPA-fallback plugin**

Write `examples/storefront-demo/vite.config.ts` exactly as:

```ts
import { copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * GitHub Pages serves `404.html` for any unknown path. Copying the built
 * `index.html` to `404.html` lets the client-side router handle deep links
 * (e.g. /product/123) instead of showing a hard 404.
 */
function spaFallback404(): Plugin {
  let outDir = "dist";
  let root = process.cwd();
  return {
    name: "spa-fallback-404",
    apply: "build",
    configResolved(cfg) {
      outDir = cfg.build.outDir;
      root = cfg.root;
    },
    closeBundle() {
      const dir = resolve(root, outDir);
      copyFileSync(resolve(dir, "index.html"), resolve(dir, "404.html"));
    },
  };
}

// `base` is `/` for local dev/build and `/emporix-sdk/` on GitHub Pages
// (set via VITE_BASE in the Pages workflow). A custom domain would set
// VITE_BASE=/ and add a CNAME.
export default defineConfig({
  base: process.env.VITE_BASE || "/",
  plugins: [react(), spaFallback404()],
});
```

- [ ] **Step 2: Set the router `basename` from the build base**

In `examples/storefront-demo/src/App.tsx`, change the open tag at line 59 from:

```tsx
        <BrowserRouter>
```

to:

```tsx
        <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
```

(`import.meta.env.BASE_URL` is Vite's injected `base`, e.g. `/emporix-sdk/` or `/`. Stripping the trailing slash yields `/emporix-sdk` or `""` — both valid React Router basenames.)

- [ ] **Step 3: Verify a default (local) build still works**

Run:
```bash
pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build
pnpm -F @viu/emporix-examples-storefront-demo build
```
Expected: build succeeds. Then:
```bash
test -f examples/storefront-demo/dist/404.html && echo "404 OK"
grep -c 'src="/assets/' examples/storefront-demo/dist/index.html
```
Expected: prints `404 OK`; the grep prints a non-zero count (assets referenced from root `/assets/` because base defaulted to `/`).

- [ ] **Step 4: Verify a Pages-style build prefixes assets with the sub-path**

Run:
```bash
VITE_BASE=/emporix-sdk/ pnpm -F @viu/emporix-examples-storefront-demo build
grep -c 'src="/emporix-sdk/assets/' examples/storefront-demo/dist/index.html
test -f examples/storefront-demo/dist/404.html && echo "404 OK"
```
Expected: the grep prints a non-zero count (assets now prefixed `/emporix-sdk/assets/`); `404 OK` prints.

- [ ] **Step 5: Smoke-test deep-link routing under the sub-path**

Run (background preview, then probe):
```bash
VITE_BASE=/emporix-sdk/ pnpm -F @viu/emporix-examples-storefront-demo exec vite preview --base /emporix-sdk/ --port 4399 &
sleep 2
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4399/emporix-sdk/
curl -s http://localhost:4399/emporix-sdk/cart | grep -c '<div id="root">'
kill %1
```
Expected: root returns `200`; the deep-link `/emporix-sdk/cart` serves the SPA shell (`<div id="root">` count `1`) — i.e. `vite preview` serves the SPA for a deep link. (Note: `vite preview` already does SPA fallback; the `404.html` is what makes the *same* behavior work on GitHub Pages.)

- [ ] **Step 6: Commit**

```bash
git add examples/storefront-demo/vite.config.ts examples/storefront-demo/src/App.tsx
git commit -m "feat(examples): make storefront-demo build Pages-ready (base, basename, 404 fallback)"
```

---

## Task 2: Remove viu-specific placeholders

**Files:**
- Modify: `examples/storefront-demo/src/config/SetupScreen.tsx` (lines 62, 82, 83)
- Modify: `examples/storefront-demo/.env.example` (line 9)
- Modify: `examples/storefront-demo/src/config/useDemoConfig.ts:10` (doc comment)
- Modify: `examples/storefront-demo/src/catalog/AddToCartBar.tsx:25` (comment)
- Modify: `examples/storefront-demo/src/lib/adapters.ts:167` (comment)

Note: the `@viu/...` strings everywhere else are the **published package scope** — leave them. Only tenant-pinned demo defaults/comments change. The Swiss/viu values (`viu`, `CHF`, `CH`) become neutral examples (`acme`, `EUR`, `DE`); `main` (site) and `https://api.emporix.io` (host) are Emporix-standard and stay.

- [ ] **Step 1: Genericize the `SetupScreen` placeholders**

In `examples/storefront-demo/src/config/SetupScreen.tsx`, change the Tenant field placeholder at line 62 from:
```tsx
          placeholder="viu"
```
to:
```tsx
          placeholder="your-tenant"
```

Change the Currency field at line 82 from:
```tsx
            <Field label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="CHF" hint="Currency + country are needed for prices to resolve." />
```
to:
```tsx
            <Field label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="EUR" hint="Currency + country are needed for prices to resolve." />
```

Change the Country field at line 83 from:
```tsx
            <Field label="Country (targetLocation)" value={targetLocation} onChange={(e) => setTargetLocation(e.target.value)} placeholder="CH" />
```
to:
```tsx
            <Field label="Country (targetLocation)" value={targetLocation} onChange={(e) => setTargetLocation(e.target.value)} placeholder="DE" />
```

- [ ] **Step 2: Genericize `.env.example`**

In `examples/storefront-demo/.env.example`, change line 9 from:
```
# VITE_DEMO_DEFAULT_TENANT=viu
```
to:
```
# VITE_DEMO_DEFAULT_TENANT=acme
```

- [ ] **Step 3: Genericize the doc/code comments**

In `examples/storefront-demo/src/config/useDemoConfig.ts` line 10, change:
```ts
  /** ISO country code for the pricing context (e.g. `CH`). Needed for price resolution. */
```
to:
```ts
  /** ISO country code for the pricing context (e.g. `DE`). Needed for price resolution. */
```

In `examples/storefront-demo/src/catalog/AddToCartBar.tsx` line 25, change:
```ts
  // viu requires a priceId on internal-type cart items — so only priced
```
to:
```ts
  // Emporix requires a priceId on internal-type cart items — so only priced
```

In `examples/storefront-demo/src/lib/adapters.ts` line 167, change:
```ts
/** The YRN the cart's `addItem` expects for a product (verified against viu). */
```
to:
```ts
/** The YRN the cart's `addItem` expects for a product (verified against the Emporix cart API). */
```

- [ ] **Step 4: Verify no tenant-specific placeholder remains**

Run:
```bash
grep -rnIE "\"viu\"|placeholder=\"viu\"|placeholder=\"CHF\"|placeholder=\"CH\"|DEFAULT_TENANT=viu" examples/storefront-demo/src examples/storefront-demo/.env.example
grep -rniE "viu" examples/storefront-demo/src | grep -vE "@viu/" | grep -viE "vious|view"
```
Expected: first grep prints nothing; second grep prints nothing (every remaining `viu` is the `@viu/` package scope).

- [ ] **Step 5: Verify the demo still builds**

Run:
```bash
pnpm -F @viu/emporix-examples-storefront-demo build
```
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add examples/storefront-demo/src examples/storefront-demo/.env.example
git commit -m "chore(examples): drop viu-specific placeholders from storefront-demo"
```

---

## Task 3: GitHub Actions Pages workflow (build + deploy from CI, no committed artifacts)

**Files:**
- Create: `.github/workflows/pages.yml`

Uses the official Pages deployment path: a `build` job uploads the artifact via `actions/upload-pages-artifact`, a `deploy` job publishes it via `actions/deploy-pages`. Nothing is committed to the repo; there is no `gh-pages` branch.

- [ ] **Step 1: Create the workflow**

Write `.github/workflows/pages.yml` exactly as:

```yaml
name: Deploy storefront-demo to Pages

on:
  push:
    branches: [main]
    paths:
      - "examples/storefront-demo/**"
      - "packages/**"
      - ".github/workflows/pages.yml"
  workflow_dispatch:

# Allow the deploy job to publish to Pages via OIDC.
permissions:
  contents: read
  pages: write
  id-token: write

# One in-flight Pages deploy at a time; don't cancel a running deploy.
concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    name: Build storefront-demo
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      # The demo imports @viu/emporix-sdk(-react) from their built dist/.
      - name: Build packages
        run: pnpm -r --filter "./packages/*" build

      - name: Build storefront-demo
        run: pnpm -F @viu/emporix-examples-storefront-demo build
        env:
          # Project-page sub-path. For a custom domain set this to "/".
          VITE_BASE: /emporix-sdk/

      - uses: actions/configure-pages@v5

      - uses: actions/upload-pages-artifact@v3
        with:
          path: examples/storefront-demo/dist

  deploy:
    name: Deploy to Pages
    needs: build
    runs-on: ubuntu-latest
    timeout-minutes: 10
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Validate the workflow YAML parses**

Run:
```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/pages.yml')); print('YAML OK')"
```
Expected: prints `YAML OK`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/pages.yml
git commit -m "ci(repo): add GitHub Pages deploy workflow for storefront-demo"
```

---

## Task 4: Document the published demo + prerequisites

**Files:**
- Modify: `examples/storefront-demo/README.md` (add a "Live demo / deployment" section)

- [ ] **Step 1: Append a deployment section to the demo README**

Add to `examples/storefront-demo/README.md` (after the existing intro):

```markdown
## Live demo & deployment

This demo is built and deployed to GitHub Pages by `.github/workflows/pages.yml`
on every push to `main` (no build artifacts are committed). Once enabled it is
served at:

```
https://viuteam.github.io/emporix-sdk/
```

It ships **no tenant binding and no secrets** — open the page and enter a tenant
+ public storefront client id on the setup screen (kept in `localStorage`).

**One-time setup (repo owner):**
- GitHub → **Settings → Pages → Source → "GitHub Actions"**.
- In the Emporix tenant you demo against, allow the `https://viuteam.github.io`
  origin (CORS, and OAuth redirect URIs if you use the login redirect).

**Custom domain / different repo:** the Pages sub-path is set via `VITE_BASE` in
the workflow (`/emporix-sdk/`). For a custom domain set `VITE_BASE=/` and add a
`CNAME`.
```

- [ ] **Step 2: Verify the README renders the code fences correctly**

Run:
```bash
grep -c "viuteam.github.io/emporix-sdk" examples/storefront-demo/README.md
```
Expected: prints `1` (or more).

- [ ] **Step 3: Commit**

```bash
git add examples/storefront-demo/README.md
git commit -m "docs(examples): document storefront-demo Pages deployment"
```

---

## Task 5: Full verification + finish

- [ ] **Step 1: Repo-wide sanity (nothing else broke)**

Run:
```bash
pnpm -r --filter "./packages/*" build
pnpm -r typecheck
```
Expected: both pass (the example typechecks against the freshly built packages).

- [ ] **Step 2: Final default-build artifact check**

Run:
```bash
pnpm -F @viu/emporix-examples-storefront-demo build
test -f examples/storefront-demo/dist/404.html && echo "404 OK"
```
Expected: `404 OK`. (Confirm `examples/storefront-demo/dist/` is git-ignored / not staged — it must never be committed.)

- [ ] **Step 3: Confirm no build artifacts are staged**

Run:
```bash
git status --short | grep -E "storefront-demo/dist" && echo "ARTIFACTS STAGED — STOP" || echo "clean"
```
Expected: prints `clean`.

- [ ] **Step 4: Finish the branch**

**REQUIRED SUB-SKILL:** `superpowers:finishing-a-development-branch`. Branch `feat/demo-gh-pages` (off `main`). After merge to `main`, the `pages.yml` workflow runs and deploys; the repo owner must have set Pages source to "GitHub Actions" first (Task 3 prerequisite).

---

## Completion

No changeset (examples are `ignore`d in `.changeset/config.json`). After merge + the one-time Pages "Source = GitHub Actions" setting, the demo is live at `https://viuteam.github.io/emporix-sdk/`, rebuilt on every push to `main`, with no committed build files.

## Self-Review

- **Coverage:** base path (T1), router basename (T1), 404 fallback (T1), viu placeholders removed (T2), CI build+deploy without committed artifacts (T3), docs + manual prerequisites (T4), no-artifact-leak guard + finish (T5). All requirements covered.
- **No placeholders:** every code/YAML step shows full content and exact commands.
- **Consistency:** `VITE_BASE` is the single source of the sub-path, used in `vite.config.ts` (`base`), surfaced via `import.meta.env.BASE_URL` (`basename`), and set in `pages.yml`. Names match across tasks.
