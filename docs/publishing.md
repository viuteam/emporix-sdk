# Publishing to npm

This repo publishes the packages under `packages/*` — `@viu/emporix-sdk`, `@viu/emporix-sdk-react`, `@viu/emporix-sdk-angular`, `@viu/emporix-sdk-next` and `@viu/emporix-mixins` — to the npm registry on every merge of a release PR cut by `changesets/action`. Everything else (`examples/*`, `e2e/`) is private and never published.

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

### 2. Trust the release workflow on npm

The workflow authenticates to npm through **Trusted Publishing** (OIDC), not a stored token — it has not used an `NPM_TOKEN` secret since `b2d8ec2` (2026-05-27). The job's `id-token: write` permission is what lets it do that.

Each published package needs a trusted publisher on npmjs.org: the package's Settings → Trusted Publisher → GitHub Actions, repository `viuteam/emporix-sdk`, workflow `release.yml`. Adding a package to `packages/*` therefore also means configuring it there; without the entry the workflow cannot publish it. Renaming `release.yml` breaks every entry at once.

### 3. The release PR's GitHub App

`changesets/action` opens the release PR with a short-lived GitHub App token (secrets `RELEASE_APP_CLIENT_ID` and `RELEASE_APP_PRIVATE_KEY`), not `GITHUB_TOKEN`: events from `GITHUB_TOKEN` never trigger other workflows, which left the required checks on the release PR stuck on "Expected".

### 4. Provenance

Provenance needs the same `id-token: write` permission. `@viu/emporix-sdk`, `-react`, `-angular` and `-next` also set `publishConfig.provenance: true`; `@viu/emporix-mixins` does not.

## What the automated pipeline does

1. You push a PR that includes a `.changeset/<slug>.md` describing the user-visible change.
2. On merge to `main`, `.github/workflows/release.yml` runs `changesets/action`. If pending changesets exist, the action opens a **release PR** named `chore(release): version packages` that:
   - Removes all the `.changeset/<slug>.md` files.
   - Bumps versions in `packages/*/package.json` per semver.
   - Updates each package's `CHANGELOG.md`.
3. Merging the release PR triggers another run of `release.yml`. This time changesets are empty → the action runs `pnpm run release` → `pnpm -r --filter "./packages/*" build && changeset publish` → packages are published to npm with provenance attestations.

You don't need to run anything manually after the initial setup.

## Checklist for a new package

Before the release PR that first publishes a new package is merged, confirm:

- [ ] The package has a trusted publisher for `viuteam/emporix-sdk` / `release.yml` on npmjs.org.
- [ ] No unintended changes in the release PR — only `version` and `CHANGELOG.md` should differ.
- [ ] The release PR's CI run is green (typecheck + tests + e2e if enabled).

Then merge.

## Troubleshooting

- **An auth error from npm publish** (`E401`, `E403` or `E404`) — usually the trusted publisher: missing for that package, or naming a different repository or workflow file than `release.yml`.
- **`E403 Forbidden — you do not have permission to publish '@viu/...'`** can also mean the scope's settings disallow public packages.
- **`provenance not enabled`** — usually the `id-token: write` permission missing from the job.
- **`No new changesets found`** — the action ran but had nothing to release; this is the expected state of the post-release-merge run.

## Re-running after a failed publish

`changesets/action` is idempotent — it will not re-publish a version that already exists on npm. If a publish failed half-way (e.g. one package published, the other didn't), re-running the workflow picks up only what's missing.

To force-recheck: trigger `release.yml` manually (Actions tab → Release → Run workflow).
