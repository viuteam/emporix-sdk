# README Build Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a CI/build status badge (plus npm-version, license, and Node badges) to the root and per-package READMEs, and make the build badge reflect the real state of `main` by adding a `push: main` trigger to the quality workflow.

**Architecture:** Approach 1 from the badge analysis — extend `.github/workflows/pr-check.yml` so the `quality` job also runs on `push: main` (today it only runs on `pull_request`, so a `?branch=main` badge would have no status to show). Then insert a badge row directly under the H1 of each README. Badges are static markdown — GitHub Actions badge is native, the rest come from shields.io.

**Tech Stack:** GitHub Actions workflow YAML, shields.io badge endpoints, Markdown.

---

## Spec reference

Implements "Ansatz 1" from the badge analysis conversation (2026-05-28). No separate design doc — the analysis settled the approach: extend `pr-check.yml` with `push: main`, add a 5-badge row (CI + 2× npm-version + license + node) to the root README and a 2-badge row (CI + own npm-version) to each package README.

## Sequencing prerequisite (read first)

Badges only render correctly once **both** are true:

1. The GitHub repo `viuteam/emporix-sdk` is **public** — the Actions badge SVG endpoint 404s for private repos without auth.
2. `@viu/emporix-sdk@2.0.0` / `@viu/emporix-sdk-react@2.0.0` are **published** — shields.io npm badges show "invalid"/"not found" until the package version exists.

This plan can be implemented and merged before those are done — the badges will simply show broken/pending states until the prerequisites are met, then self-heal (no further commit needed). If you want the README to look correct the moment it merges, do the public-flip + publish first.

## File structure

```
.github/workflows/pr-check.yml   — add `push: [main]` to the `on:` triggers
README.md                        — badge row under the H1
packages/sdk/README.md           — CI + sdk npm-version badges under the H1
packages/react/README.md         — CI + react npm-version badges under the H1
.changeset/readme-build-badges.md — empty changeset (CI/docs only, no version bump)
```

## Conventions

- Commit subject: `<type>(<scope>): <lowercase-verb> …`. Scopes here: `repo` (workflow), `docs` (READMEs), `release` (changeset). First word after the scope MUST be a lowercase verb — commitlint rejects sentence-case.
- Branch: `chore/readme-badges` off `main`.
- All commits end with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- Husky pre-commit runs `pnpm lint` + `pnpm typecheck`. Neither is affected by YAML/markdown changes, so the hook passes trivially — but it still runs.

## Task 0: Branch

- [ ] **Step 1: Create the branch off main**

```bash
cd /Users/dominic.fritschi/projects/viu/emporix-sdk
git checkout main
git checkout -b chore/readme-badges
git branch --show-current
```
Expected: `chore/readme-badges`.

---

## Task 1: Add `push: main` trigger to the quality workflow

**Files:**
- Modify: `.github/workflows/pr-check.yml:3-5`

- [ ] **Step 1: Edit the `on:` block**

Replace:

```yaml
on:
  pull_request:
    branches: [main]
```

with:

```yaml
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
```

Leave everything else (the `concurrency` group, the `quality` job, the `[20, 22, 24]` matrix) unchanged. The `concurrency.group` is `pr-check-${{ github.ref }}` — on a `push` to main, `github.ref` is `refs/heads/main`, so push runs get their own concurrency lane and won't cancel in-flight PR runs.

- [ ] **Step 2: Verify the YAML parses**

```bash
node -e "const fs=require('fs'); const s=fs.readFileSync('.github/workflows/pr-check.yml','utf8'); if(!/push:\s*\n\s*branches:\s*\[main\]/.test(s)) throw new Error('push trigger not found'); console.log('OK: push:main trigger present');"
```
Expected: `OK: push:main trigger present`.

(If `actionlint` is installed locally — `which actionlint` — also run `actionlint .github/workflows/pr-check.yml` for a full schema check. It is not a hard dependency; the node regex check above is sufficient.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/pr-check.yml
git commit -m "chore(repo): run quality workflow on push to main

The quality job (typecheck + lint + test on Node 20/22/24) only
triggered on pull_request, so its Actions badge had no run
associated with the main branch ref — a ?branch=main badge would
show 'no status'. Adding a push:main trigger makes the badge
reflect the real post-merge state of main. The concurrency group
keys on github.ref, so push runs use a separate lane and never
cancel in-flight PR runs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Badge row in the root README

**Files:**
- Modify: `README.md:1-4`

- [ ] **Step 1: Insert the badge row under the H1**

The file currently starts:

```markdown
# emporix-sdk

TypeScript SDK for the [Emporix Commerce Engine](https://developer.emporix.io),
shipped as a pnpm workspace monorepo.
```

Change it to:

```markdown
# emporix-sdk

[![CI](https://github.com/viuteam/emporix-sdk/actions/workflows/pr-check.yml/badge.svg?branch=main)](https://github.com/viuteam/emporix-sdk/actions/workflows/pr-check.yml)
[![@viu/emporix-sdk](https://img.shields.io/npm/v/@viu/emporix-sdk?label=%40viu%2Femporix-sdk)](https://www.npmjs.com/package/@viu/emporix-sdk)
[![@viu/emporix-sdk-react](https://img.shields.io/npm/v/@viu/emporix-sdk-react?label=%40viu%2Femporix-sdk-react)](https://www.npmjs.com/package/@viu/emporix-sdk-react)
[![license](https://img.shields.io/npm/l/@viu/emporix-sdk)](./LICENSE)
[![node](https://img.shields.io/node/v/@viu/emporix-sdk)](https://nodejs.org)

TypeScript SDK for the [Emporix Commerce Engine](https://developer.emporix.io),
shipped as a pnpm workspace monorepo.
```

- [ ] **Step 2: Verify the markdown is well-formed**

```bash
node -e "const fs=require('fs'); const s=fs.readFileSync('README.md','utf8'); const m=s.match(/\]\(https?:[^)]+\)/g)||[]; const bad=m.filter(x=>/\s/.test(x)); if(bad.length) throw new Error('badge link contains whitespace: '+bad.join(', ')); if(!s.includes('actions/workflows/pr-check.yml/badge.svg')) throw new Error('CI badge missing'); console.log('OK: '+m.length+' links, CI badge present');"
```
Expected: `OK: <n> links, CI badge present` with no whitespace error.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(repo): add CI + npm + license + node badges to root readme

Five-badge row under the H1: GitHub Actions quality status (pinned
to main), npm version for both published packages, license, and the
Node engines floor. npm badges resolve once 2.0.0 is published; the
CI badge resolves once the repo is public.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Badge row in the SDK package README

**Files:**
- Modify: `packages/sdk/README.md:1-4`

- [ ] **Step 1: Insert the badge row under the H1**

The file currently starts:

```markdown
# @viu/emporix-sdk

Framework-agnostic TypeScript SDK for the Emporix Commerce Engine. Native
`fetch` only (Node 20.19+), zero runtime dependencies.
```

Change it to:

```markdown
# @viu/emporix-sdk

[![CI](https://github.com/viuteam/emporix-sdk/actions/workflows/pr-check.yml/badge.svg?branch=main)](https://github.com/viuteam/emporix-sdk/actions/workflows/pr-check.yml)
[![npm](https://img.shields.io/npm/v/@viu/emporix-sdk)](https://www.npmjs.com/package/@viu/emporix-sdk)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@viu/emporix-sdk)](https://bundlephobia.com/package/@viu/emporix-sdk)

Framework-agnostic TypeScript SDK for the Emporix Commerce Engine. Native
`fetch` only (Node 20.19+), zero runtime dependencies.
```

(The `bundlephobia` badge is included here because "zero runtime dependencies" is this package's headline selling point — the minzip badge reinforces it. It resolves once the package is published and Bundlephobia has indexed it, typically within ~1h.)

- [ ] **Step 2: Verify**

```bash
node -e "const fs=require('fs'); const s=fs.readFileSync('packages/sdk/README.md','utf8'); if(!s.includes('img.shields.io/npm/v/@viu/emporix-sdk')) throw new Error('npm badge missing'); if(!s.includes('pr-check.yml/badge.svg')) throw new Error('CI badge missing'); console.log('OK: sdk readme badges present');"
```
Expected: `OK: sdk readme badges present`.

- [ ] **Step 3: Commit**

```bash
git add packages/sdk/README.md
git commit -m "docs(sdk): add CI + npm + bundle-size badges to package readme

CI status (main), npm version, and a bundlephobia minzip badge that
reinforces the zero-runtime-dependency selling point.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Badge row in the React package README

**Files:**
- Modify: `packages/react/README.md:1-4`

- [ ] **Step 1: Insert the badge row under the H1**

The file currently starts:

```markdown
# @viu/emporix-sdk-react

React bindings for `@viu/emporix-sdk`, built on
[`@tanstack/react-query`](https://tanstack.com/query) v5. Supports React 18 & 19.
```

Change it to:

```markdown
# @viu/emporix-sdk-react

[![CI](https://github.com/viuteam/emporix-sdk/actions/workflows/pr-check.yml/badge.svg?branch=main)](https://github.com/viuteam/emporix-sdk/actions/workflows/pr-check.yml)
[![npm](https://img.shields.io/npm/v/@viu/emporix-sdk-react)](https://www.npmjs.com/package/@viu/emporix-sdk-react)

React bindings for `@viu/emporix-sdk`, built on
[`@tanstack/react-query`](https://tanstack.com/query) v5. Supports React 18 & 19.
```

- [ ] **Step 2: Verify**

```bash
node -e "const fs=require('fs'); const s=fs.readFileSync('packages/react/README.md','utf8'); if(!s.includes('img.shields.io/npm/v/@viu/emporix-sdk-react')) throw new Error('npm badge missing'); if(!s.includes('pr-check.yml/badge.svg')) throw new Error('CI badge missing'); console.log('OK: react readme badges present');"
```
Expected: `OK: react readme badges present`.

- [ ] **Step 3: Commit**

```bash
git add packages/react/README.md
git commit -m "docs(react): add CI + npm badges to package readme

CI status (main) + npm version for @viu/emporix-sdk-react.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Empty changeset

The READMEs are part of the published package tarballs (`files: ["dist", "README.md", …]`), but adding badges is purely cosmetic — no API or runtime change. An empty changeset documents the change and keeps the `changeset-check.yml` PR gate green without forcing a version bump. The badges flow to the npm package page on the next real release; the GitHub repo view updates immediately on merge.

**Files:**
- Create: `.changeset/readme-build-badges.md`

- [ ] **Step 1: Write the empty changeset**

`.changeset/readme-build-badges.md`:

```markdown
---
---

Add CI / npm / license / Node badges to the root and per-package READMEs, and run the quality workflow on push to `main` so the CI badge reflects the post-merge state. Documentation + CI only — no version bump.
```

(Empty frontmatter = no package listed = no version bump, consumed on the next `changeset version` run.)

- [ ] **Step 2: Verify the changeset is empty-but-valid**

```bash
pnpm changeset status 2>&1 | tail -5
```
Expected: the new changeset does not add any package to a bump tier (no `@viu/emporix-sdk` / `-react` lines attributable to this file). It is fine if other pending changesets still show bumps — this one contributes none.

- [ ] **Step 3: Commit**

```bash
git add .changeset/readme-build-badges.md
git commit -m "chore(release): empty changeset for readme badge addition

Badges + the push:main workflow trigger are docs/CI only — no
consumer-facing change, so no version bump. Empty changeset keeps
the changeset-check gate satisfied.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Repo-wide checks still pass (nothing code-level changed, this is a sanity gate)

```bash
pnpm -r typecheck
pnpm -r lint
```
Expected: all green (YAML/markdown changes don't touch TS, so this is unaffected — but confirms the tree is healthy).

- [ ] Confirm the four edits landed

```bash
git diff main..HEAD --stat
```
Expected: 5 files changed — `.github/workflows/pr-check.yml`, `README.md`, `packages/sdk/README.md`, `packages/react/README.md`, `.changeset/readme-build-badges.md`.

- [ ] Push + open PR

```bash
git push -u origin chore/readme-badges
gh pr create --base main --title "chore: add build/npm badges to READMEs" --body "$(cat <<'EOF'
## Summary
- Run the quality workflow on `push: main` so the CI badge tracks main (was `pull_request`-only).
- Add a CI + npm-version + license + Node badge row to the root README.
- Add CI + npm-version (+ bundle-size for the SDK) badges to both package READMEs.

## Notes
Badges render once the repo is public (Actions badge) and 2.0.0 is published (npm badges). They self-heal — no follow-up commit needed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **After merge — visual confirmation (manual, once repo public + published):**
  - Open `https://github.com/viuteam/emporix-sdk` → the CI badge under the title shows green (or the real status).
  - Open `https://www.npmjs.com/package/@viu/emporix-sdk` → the README renders the badge row.
  - If the CI badge shows "no status": confirm a `push: main` run has happened (merge this PR, that push itself triggers the first main run).
