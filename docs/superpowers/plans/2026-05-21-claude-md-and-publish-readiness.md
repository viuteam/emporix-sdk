# CLAUDE.md + NPM Publishing Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repo-level `CLAUDE.md` that captures the conventions Claude needs across sessions, and close the gaps that today block publishing `@viu/emporix-sdk` and `@viu/emporix-sdk-react` to npm — missing license, missing `package.json` metadata, and an unverified `NPM_TOKEN` secret. After this plan, the next `changesets/action` run in CI can actually publish to the npm registry.

**Architecture:** Two independent threads in one plan because they jointly form "the repo is ready for first public release":

1. **CLAUDE.md** at the repo root: declarative source of truth for repo-wide conventions (commitlint, scripts, test layout, branching). Claude reads it at session start; humans get a quick orientation doc.
2. **npm publishing readiness**: add `LICENSE` + license-spdx, fill missing `package.json` metadata (`repository`, `bugs`, `homepage`, `author`, `keywords`, `engines.node`), document the operator-side prerequisites (npm scope, `NPM_TOKEN` secret) that cannot be set from the repo itself.

**Tech Stack:** Markdown, JSON edits, no runtime code changes. Pre-commit hook runs typecheck + lint; both must stay green.

**Context for the engineer:**

- Branch: `feat/claude-md-and-publish-readiness` (already created off `main`).
- The two existing public packages have `version: 0.0.0`. The first changeset-driven release will bump them to `0.1.0` (minor) automatically; no manual version bump in this plan.
- Provenance is already enabled (`NPM_CONFIG_PROVENANCE: "true"` in `.github/workflows/release.yml`, `id-token: write` permission, `publishConfig.provenance: true` per package). Once `NPM_TOKEN` is set and the scope exists, the next push to `main` triggers an automated publish — that's the whole flow.
- `@viu/emporix-examples-*` packages are already marked `ignore` in `.changeset/config.json` and `privatePackages.version: false` — they will not be published. Don't change that.
- Commitlint allowed scopes: `repo, release, sdk, react, core, customer, product, category, cart, checkout, payment, price, media, segment, auth, http, logger, deps, docs, examples`. Lowercase first word in the subject line. Use `chore(repo): …` for root-level config changes, `chore(release): …` for release-mechanics changes.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `CLAUDE.md` | Repo-wide conventions readable by Claude on session-start | **CREATE** |
| `LICENSE` | Standard SPDX license file (root) | **CREATE** — MIT (final choice in Task 2 Step 0) |
| `packages/sdk/package.json` | SDK published metadata | Add `license`, `repository`, `bugs`, `homepage`, `author`, `keywords`, `engines` |
| `packages/react/package.json` | React-bindings published metadata | Same fields as SDK |
| `docs/publishing.md` | One-page operator guide: scope, tokens, first release | **CREATE** |

No code changes. No package versions bumped manually.

---

## Task 1: Author `CLAUDE.md`

**Files:**
- Create: `CLAUDE.md`

- [ ] **Step 1: Inventory what should be in it**

The file is loaded into Claude's context at every session start in this repo. Make every line earn its place: include only things that are non-obvious from a quick `ls` + `cat package.json`. The first draft must cover, in this order:

1. **What this repo is** (1 paragraph): a TypeScript SDK + React bindings for the Emporix Commerce Engine. Public consumer: storefronts. Internal consumer: the viu tenant.
2. **Workspace layout**: `packages/sdk`, `packages/react`, `examples/*`, `e2e/`. One sentence each.
3. **Critical commands**: `pnpm -r build`, `pnpm -r test`, `pnpm e2e`, `pnpm changeset`. With one-line purpose each.
4. **Commitlint constraints**: the scope-enum allowlist (verbatim), the "first word lowercase verb" rule. Reference: `.changeset/config.json` and the husky `commit-msg` hook.
5. **Branching + PR workflow**: feature branches via `feat/<short-name>`, PRs against `main`, changesets land in `.changeset/<slug>.md`, the `changesets/action` cuts release PRs automatically.
6. **Test architecture**: Vitest unit tests in each package (mocked HTTP via MSW). Playwright e2e under `e2e/` against the live `viu` tenant. Skip credentials → some e2e specs skip cleanly. `pnpm -r test` covers unit; `pnpm e2e` covers e2e.
7. **Where each kind of doc lives**: `docs/*.md` (public-facing), `docs/superpowers/specs/*` (design docs), `docs/superpowers/plans/*` (implementation plans). README.md per package for npm.
8. **Things that are easy to get wrong**: `useCart` returns `Cart` (uses `.id`); `useCreateCart` returns `CartCreated` (uses `.cartId`) — these are two different shapes. `useCheckout` auto-detects auth (customer if token in storage, else anonymous); `usePaymentModes` is customer-only. Cart-merge target is the customer-cart ID, not the anonymous one.
9. **Storage backends** (`@viu/emporix-sdk-react`): three implementations — memory, localStorage, cookie. Persist `customerToken`, `cartId`, `anonymousSession`. The anonymous-session persistence is what makes the guest cart survive reloads (see PR #26).
10. **Released artifacts**: `@viu/emporix-sdk` + `@viu/emporix-sdk-react`. Everything else is private (`examples/*`, `e2e/`).

- [ ] **Step 2: Write the file**

Create `CLAUDE.md` at the repo root:

```markdown
# CLAUDE.md

Repo-wide conventions for Claude / agentic workflows. Read me at session start.

## What this is

A TypeScript SDK and React bindings for the Emporix Commerce Engine. Published as `@viu/emporix-sdk` and `@viu/emporix-sdk-react` on npm. The `viu` tenant is the primary internal consumer; external storefronts can use it via the public packages.

## Workspace layout

| Path | Purpose | Released? |
|---|---|---|
| `packages/sdk` | Core SDK: HTTP, auth, services (Product, Category, Cart, Checkout, Customer, Price, Media, Segment) | yes (`@viu/emporix-sdk`) |
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
- **First word after the scope must be lowercase**. `feat(react): add useCreateCart` ✓ — `feat(react): useCreateCart added` is sometimes OK; `feat(react): Add useCreateCart` ✗.
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
- `EmporixStorage` keys: `emporix.customerToken`, `emporix.cartId`, `emporix.anonymousSession`. The last one carries `{ refreshToken, sessionId }` and is what makes the guest cart survive page reloads (PR #26).
- Examples typecheck against the built `dist/` of `@viu/emporix-sdk` and `@viu/emporix-sdk-react`. Run `pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build` before `pnpm -F @viu/emporix-examples-* typecheck` if you've changed SDK/React source.

## When you're not sure

Read `docs/auth.md`, `docs/react.md`, `docs/e2e.md`, `docs/pagination.md`. Design specs and implementation plans live under `docs/superpowers/specs/` and `docs/superpowers/plans/` respectively. The most recent specs are the closest to today's behavior.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(repo): add CLAUDE.md with conventions and commands"
```

---

## Task 2: Add `LICENSE` + `license` field

**Files:**
- Create: `LICENSE`
- Modify: `packages/sdk/package.json`
- Modify: `packages/react/package.json`

- [ ] **Step 0: Confirm the license**

The plan assumes **MIT**. If a different license is required (commercial, proprietary, dual-license), stop here and discuss with the operator before proceeding — switching later is messy.

- [ ] **Step 1: Create `LICENSE`**

Use the standard MIT template. Replace `<YEAR>` and `<COPYRIGHT HOLDER>`:

```
MIT License

Copyright (c) 2026 viuteam

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Add `license` field to `packages/sdk/package.json`**

Add at the top level (next to `"description"`):

```json
"license": "MIT",
```

- [ ] **Step 3: Mirror into `packages/react/package.json`**

Same field, same value.

- [ ] **Step 4: Verify**

Run: `pnpm -r typecheck && pnpm -r test` — both should stay green.

- [ ] **Step 5: Commit**

```bash
git add LICENSE packages/sdk/package.json packages/react/package.json
git commit -m "chore(repo): add MIT LICENSE and license metadata"
```

---

## Task 3: Add the remaining `package.json` metadata

**Files:**
- Modify: `packages/sdk/package.json`
- Modify: `packages/react/package.json`

- [ ] **Step 1: Decide on the GitHub URL**

The repo is at `https://github.com/viuteam/emporix-sdk`. Use that consistently in `repository.url`, `bugs.url`, and `homepage`. If the repo moves later, the metadata must move with it.

- [ ] **Step 2: Add the fields to `packages/sdk/package.json`**

Add these at the top level (preserve existing keys):

```json
"homepage": "https://github.com/viuteam/emporix-sdk#readme",
"repository": {
  "type": "git",
  "url": "git+https://github.com/viuteam/emporix-sdk.git",
  "directory": "packages/sdk"
},
"bugs": {
  "url": "https://github.com/viuteam/emporix-sdk/issues"
},
"author": "viuteam <opensource@viu.com>",
"keywords": [
  "emporix",
  "ecommerce",
  "commerce",
  "sdk",
  "typescript",
  "storefront"
],
"engines": {
  "node": ">=18"
},
```

> The `"author"` email is illustrative — replace with the real maintainer mailbox before merging. If no public email exists yet, drop the `<...>` part: `"author": "viuteam"`.

- [ ] **Step 3: Add the same fields to `packages/react/package.json`**

Same block, except `repository.directory` → `"packages/react"` and add React-relevant keywords:

```json
"keywords": [
  "emporix",
  "ecommerce",
  "commerce",
  "react",
  "react-query",
  "hooks",
  "typescript",
  "storefront"
],
```

- [ ] **Step 4: Verify**

```bash
pnpm -r typecheck
pnpm -r test
pnpm -F @viu/emporix-sdk pack --dry-run
pnpm -F @viu/emporix-sdk-react pack --dry-run
```

The `pack --dry-run` lists the files that would land in the tarball. Confirm `dist/`, `README.md`, `LICENSE`, `CHANGELOG.md` (if present), `package.json` are included. Anything unexpected → tighten `files` in `package.json`.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/package.json packages/react/package.json
git commit -m "chore(repo): add repository, bugs, homepage, author, keywords to package.json"
```

---

## Task 4: Write the `docs/publishing.md` operator guide

**Files:**
- Create: `docs/publishing.md`

- [ ] **Step 1: Draft the doc**

This doc lists the **operator-side** steps that cannot be done from the repo itself — npm scope creation, token provisioning, two-factor-auth setup. It also points operators at the automated parts so they don't redo them by hand.

```markdown
# Publishing to npm

This repo publishes `@viu/emporix-sdk` and `@viu/emporix-sdk-react` to the npm registry on every merge of a release PR cut by `changesets/action`. Everything else (`examples/*`, `e2e/`) is private and never published.

## One-time setup (operator)

These steps cannot be done from the repo — they live on npmjs.org and in GitHub repo settings.

### 1. Claim or join the `@viu` npm scope

If the `@viu` scope doesn't exist on npmjs.org yet:

```bash
npm login
npm org create viu               # creates the @viu scope owned by your user
npm team create viu:developers   # team that can publish
npm team add viu:developers <user>
```

If the scope already exists, an existing owner needs to add the release identity as a member of the publishing team:

```bash
npm team add viu:developers <release-user>
```

All packages under `@viu/...` inherit the scope's billing + access settings.

### 2. Provision the `NPM_TOKEN` GitHub secret

The release workflow needs a token with publish rights to the `@viu` scope.

**Option A — classic Granular Access Token (recommended for CI):**

1. Log into npmjs.org with the release identity.
2. Settings → Access Tokens → Generate New Token → "Granular Access Token".
3. Scope: read + write on `@viu/*`. Expiration: 1 year (set a calendar reminder to rotate).
4. Copy the token.
5. In GitHub: Repo → Settings → Secrets and variables → Actions → New repository secret.
6. Name: `NPM_TOKEN`. Value: the token. Save.

**Option B — Trusted Publishers (OIDC, no token storage; only if your scope opted in):**

Configure the npm scope to trust the GitHub repo's `release.yml` workflow via npm's Trusted Publishers UI. Then drop `NPM_TOKEN` from the workflow entirely; `id-token: write` (already set) is enough.

Today the workflow uses Option A — `NPM_TOKEN` from `secrets`. Switch to Option B later if your account supports it.

### 3. Verify provenance prerequisites

Provenance is already enabled in this repo:

- `NPM_CONFIG_PROVENANCE: "true"` in `release.yml`.
- `id-token: write` permission in the job.
- `publishConfig.provenance: true` in each package.

For provenance to work, the publishing identity must have 2FA enabled on npmjs.org (`Settings → Account` → Two-Factor Authentication). 2FA-on-write is mandatory by npm policy for new packages since Sep 2023.

## What the automated pipeline does

1. You push a PR that includes a `.changeset/<slug>.md` describing the user-visible change.
2. On merge to `main`, `.github/workflows/release.yml` runs `changesets/action`. If pending changesets exist, the action opens a **release PR** named `chore(release): version packages` that:
   - Removes all the `.changeset/<slug>.md` files.
   - Bumps versions in `packages/*/package.json` per semver.
   - Updates each package's `CHANGELOG.md`.
3. Merging the release PR triggers another run of `release.yml`. This time changesets are empty → the action runs `pnpm run release` → `pnpm -r --filter "./packages/*" build && changeset publish` → packages are published to npm with provenance attestations.

You don't need to run anything manually after the initial setup.

## First release checklist

Before merging the first release PR, confirm:

- [ ] `NPM_TOKEN` secret is set in GitHub repo settings.
- [ ] `@viu` scope exists on npmjs.org and the release user has publish rights.
- [ ] Both packages have `version: 0.0.0` (or whatever pre-release version) on `main`. The release PR will bump these.
- [ ] No unintended changes in the release PR — only `version` and `CHANGELOG.md` should differ.
- [ ] The release-PR's CI run is green (typecheck + tests + e2e if enabled).

Then merge.

## Troubleshooting

- **`E401 Unauthorized` from npm publish** — token missing, expired, or lacks scope write. Re-check the `NPM_TOKEN` secret value and its npm scope permissions.
- **`E403 Forbidden — you do not have permission to publish '@viu/...'`** — the publishing identity is not a member of the `@viu:developers` team, or the scope billing settings disallow public packages.
- **`provenance not enabled`** — usually a workflow permissions issue (`id-token: write` missing) or 2FA not enabled on the npm account.
- **`No new changesets found`** — the action ran but had nothing to release; this is the expected state of the post-release-merge run.

## Re-running after a failed publish

`changesets/action` is idempotent — it will not re-publish a version that already exists on npm. If a publish failed half-way (e.g. one package published, the other didn't), re-running the workflow picks up only what's missing.

To force-recheck: trigger `release.yml` manually (Actions tab → Release → Run workflow).
```

- [ ] **Step 2: Commit**

```bash
git add docs/publishing.md
git commit -m "docs(repo): operator guide for npm publishing setup"
```

---

## Task 5: Smoke-check the release pipeline locally

**Files:** none

- [ ] **Step 1: Verify the changeset config is intact**

Run: `cat .changeset/config.json` — confirm:
- `"access": "public"` ✓
- `"ignore": ["@viu/emporix-examples-*"]` ✓
- `"privatePackages": { "version": false, "tag": false }` ✓

Don't change this; it's already correct.

- [ ] **Step 2: Dry-run a version bump**

```bash
git stash --include-untracked   # if you have unrelated work in progress
pnpm changeset version          # simulates what changesets/action would do
git status
git diff
```

You should see:
- All open `.changeset/<slug>.md` files are deleted.
- `packages/sdk/package.json` and `packages/react/package.json` have new versions.
- `packages/sdk/CHANGELOG.md` and `packages/react/CHANGELOG.md` are written/updated.

**Discard the dry run:** `git restore packages/ .changeset/` to revert. Then `git stash pop` if you stashed.

- [ ] **Step 3: Dry-run a publish (no actual upload)**

```bash
pnpm -F @viu/emporix-sdk publish --dry-run --no-git-checks
pnpm -F @viu/emporix-sdk-react publish --dry-run --no-git-checks
```

Read the output:
- `npm notice` headers should show name + version + license + repository + provenance flag.
- File list should contain `dist/`, `README.md`, `LICENSE`, `CHANGELOG.md` (if present).
- "Tarball size" reasonable (< 1 MB for SDK; < 200 KB for react).

If the output is missing `LICENSE` from the tarball, add `"LICENSE"` to the `files` array in the package.json:

```json
"files": ["dist", "README.md", "CHANGELOG.md", "LICENSE"]
```

> npm's default behavior is to **always** include `LICENSE` regardless of `files`, but explicit is safer.

- [ ] **Step 4: Commit any `files` adjustments (if needed)**

```bash
git add packages/sdk/package.json packages/react/package.json
git commit -m "chore(repo): include LICENSE in package tarballs"
```

If no changes are needed, skip this step.

---

## Final Verification

- [ ] **Repo-wide build + tests**

```bash
pnpm -r build
pnpm -r test
pnpm typecheck
```

Expected: all green. No code was changed, so this is a regression-safety net.

- [ ] **Pack-dry-run produces the right tarballs**

```bash
pnpm -F @viu/emporix-sdk pack --dry-run | tail -10
pnpm -F @viu/emporix-sdk-react pack --dry-run | tail -10
```

Confirm both packages list:
- `dist/` (with `.js`, `.cjs`, `.d.ts` for each entry-point)
- `README.md`
- `LICENSE`
- `package.json`

- [ ] **Operator checklist printed**

```bash
cat docs/publishing.md
```

Confirm the first-release checklist is present and accurate.

- [ ] **CLAUDE.md is loaded next session**

Open a fresh Claude session in this repo. The first message should reference items from `CLAUDE.md` automatically (test by asking "what are the allowed commit scopes?" — Claude should answer from the file, not by re-grepping).

---

## What's NOT in this plan (operator must do these)

These can't be done from the repo. Listed here so they don't fall through the cracks:

1. **Create or join the `@viu` npm scope** — npmjs.org account, scope creation, team membership.
2. **Set `NPM_TOKEN` repo secret** — GitHub Settings → Secrets and variables → Actions.
3. **Enable 2FA on the publishing npm identity** — required for provenance.
4. **Replace the placeholder `author` email** with the real maintainer mailbox in both package.jsons. If unclear, drop the email and leave just `"author": "viuteam"`.
5. **Decide if the license is really MIT** — confirm with legal/leadership. If not MIT, replace both `LICENSE` and the `license` field in package.jsons (this plan assumes MIT).

Once 1-3 are done, the next merge to `main` that includes a changeset will result in a real npm publish. Test with a tiny patch-level changeset (e.g. a typo fix in a README) so the first published version is recoverable if anything goes wrong.

---

## Out-of-scope follow-ups

- Public npm-readable READMEs (audit + polish `packages/sdk/README.md` and `packages/react/README.md` for first-impression quality on npmjs.org).
- `CONTRIBUTING.md` for external contributors.
- `SECURITY.md` for vulnerability reporting.
- `CODEOWNERS` for review routing.
- npm Trusted Publishers OIDC migration (replaces `NPM_TOKEN` with workflow identity).
- Versioning policy doc — e.g. "we go to 1.0.0 after the first month of stable production usage".
