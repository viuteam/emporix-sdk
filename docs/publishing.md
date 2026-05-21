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

**Option A — Granular Access Token (recommended for CI):**

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
