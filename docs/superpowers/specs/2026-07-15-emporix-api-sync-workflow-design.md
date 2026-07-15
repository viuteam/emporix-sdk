# Emporix API Sync Workflow — Design

Date: 2026-07-15

## Problem

The SDK vendors ~40 Emporix OpenAPI specs (`packages/sdk/specs/*.yml`) and
generates types from them (`packages/sdk/src/generated/`). When upstream
(`emporix/api-references`) changes, these drift silently until someone runs
`fetch:specs` + `generate` by hand. We want a daily, automated check that opens
a PR whenever the vendored specs fall behind.

## Solution

A scheduled GitHub Actions workflow, `.github/workflows/api-sync.yml`, that
reuses the existing SDK scripts and the release GitHub App.

### Trigger

- `schedule: cron "0 6 * * *"` — daily at 06:00 UTC.
- `workflow_dispatch` — manual runs for testing.
- `concurrency: api-sync`, `cancel-in-progress: false` — no overlapping runs.

### Flow (job `sync`, ubuntu-latest, node 24)

1. `actions/create-github-app-token@v2` with `RELEASE_APP_ID` /
   `RELEASE_APP_PRIVATE_KEY` (same app as `release.yml`). PRs opened with the
   default `GITHUB_TOKEN` do not trigger downstream workflows, which would leave
   the required `pr-check` / `changeset-check` stuck on "Expected".
2. Checkout (with app token), pnpm, node, `pnpm install --frozen-lockfile`.
3. `pnpm -F @viu/emporix-sdk fetch:specs` — re-fetch specs; overwrites
   `specs/*.yml` and `.sync-manifest.json`.
4. **Detect changes.** `fetch:specs` always rewrites `.sync-manifest.json`
   (`generatedAt` / `fetchedAt` timestamps), so the manifest is not a reliable
   drift signal. Inspect only the `*.yml` specs:
   `git status --porcelain -- packages/sdk/specs` filtered to `*.yml`.
   - No `*.yml` change → `git checkout` the manifest (discard timestamp churn),
     end the job green, open no PR.
   - `*.yml` change → collect the changed service names, continue.
5. `pnpm -F @viu/emporix-sdk generate` — regenerate `src/generated/`.
6. `pnpm -F @viu/emporix-sdk build` then `check:treeshake` — smoke gate. A broken
   generation fails the job here, so a broken PR is never opened.
7. Write `.changeset/emporix-api-sync.md` (`"@viu/emporix-sdk": patch`, with the
   changed-service list). Fixed filename → repeated runs don't accumulate
   changesets. `patch` is the safe default; reviewers bump to `minor` when the
   change is additive API surface.
8. `peter-evans/create-pull-request@v7` (app token) → commits specs + generated +
   changeset onto the fixed branch `chore/emporix-api-sync` and opens/updates a
   single PR against `main`. Idempotent: repeated runs update the same PR.
   Commit/title `chore(sdk): sync generated types with upstream emporix api
   specs` (commitlint-conform: scope `sdk`, lowercase verb `sync`).

### Out of scope (YAGNI)

- Per-service PRs, auto-merge.
- Duplicating `typecheck` / `lint` / `test` in the sync job — `pr-check.yml`
  runs the full quality gate on the opened PR.

### Assumptions

- The app behind `RELEASE_APP_ID` has `contents:write` + `pull-requests:write`
  (already used by `release.yml`).
- `peter-evans/create-pull-request` is acceptable as a third-party action
  (the repo already uses several).
