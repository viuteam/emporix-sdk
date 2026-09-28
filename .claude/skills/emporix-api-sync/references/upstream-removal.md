# When upstream moves or removes a spec

The daily sync fails with `Failed to fetch <spec> spec: 404 <url>`, run after
run. Two different things produce that 404, and they need opposite fixes — find
out which one happened before editing anything.

## Moved, or removed?

```bash
# Is the directory still there — perhaps renamed, or with another extension?
gh api repos/emporix/api-references/contents/<area> --jq '.[].name'

# Is anything with that name left anywhere in the tree?
gh api "repos/emporix/api-references/git/trees/main?recursive=1" \
  --jq '.tree[] | select(.path | test("<name>"; "i")) | .path'

# Which commit took it away, and when did that reach main?
gh api "repos/emporix/api-references/commits?path=<area>/<dir>&per_page=5" \
  --jq '.[] | "\(.sha[0:10])  \(.commit.committer.date)  \(.commit.message | split("\n")[0])"'
gh api "repos/emporix/api-references/commits/<sha>/pulls" \
  --jq '.[] | "#\(.number)  merged \(.merged_at)  \(.title)"'
```

The commit date is when the change was written, not when it landed. Pick-Pack's
removal commit is dated 2026-08-27 but merged on 2026-09-16 13:10 UTC — between
the last green run (11:20) and the first failed one. The merge time is the one
that has to line up.

- **Moved or renamed** — a new directory, or `api.yml` → `api.yaml` (three specs
  in `SPECS` already use `.yaml`). Fix the URL in `SPECS`; nothing else changes
  and nothing breaks. The next run vendors from the new place.
- **Removed** — nothing left in the tree, and the
  [Emporix changelog](https://developer.emporix.io/changelog) carries a
  "removal of deprecated endpoints" entry calling the service End of Life.
  Remove the service from the SDK, as #302 did for SEPA Export (3.0.0) and #340
  for Pick-Pack (4.0.0). Both had been `@deprecated` in the SDK for months, which
  is worth checking: a removal nobody was warned about is a harder conversation.

## Removing a service

A breaking change with a `major` changeset, in its own PR with nothing else in
it — no sync, no unrelated facade work. Everything the service touches:

| Where | What goes |
|---|---|
| `packages/sdk/scripts/fetch-specs.ts` | the `SPECS` entry |
| `packages/sdk/specs/` | `<svc>.yml`, and its entry in `.sync-manifest.json` |
| `packages/sdk/src/generated/<svc>/` | the whole directory |
| `packages/sdk/src/services/` | `<svc>.ts` and `<svc>-types.ts` |
| `packages/sdk/src/<svc>.ts` | the subpath re-export |
| `packages/sdk/src/client.ts` | the import, the `readonly` property, the constructor line |
| `packages/sdk/src/index.ts` | the `export *` |
| `packages/sdk/src/core/logger.ts` | the `ServiceName` channel |
| `packages/sdk/scripts/check-treeshake.mjs` | its marker, if listed — it could no longer appear in any bundle, so the probe would pass vacuously |
| `packages/sdk/tsup.config.ts`, `packages/sdk/package.json` `exports` | a per-service entry, if the service has one |
| tests | the service's own tests; its wiring test **inverts** instead (below) |
| docs | `docs/<svc>.md`, and the service lists in `README.md`, `packages/sdk/README.md` and `CLAUDE.md` |

The wiring test stays and asserts absence, so a re-introduction fails a test
instead of passing silently:

```ts
expect("pickPack" in sdk).toBe(false);
```

**Leave history alone:** CHANGELOGs, `docs/superpowers/`, earlier entries in
`docs/emporix-upstream-changelog.md`, dated measurements. They describe the past
correctly. Then look for what is left:

```bash
git grep -n -i -E "<name-pattern>" -- . ':!**/CHANGELOG.md' ':!docs/superpowers/**'
```

Hits inside an upstream spec are not yours — Pick-Pack left a
`pickPackNoSequence` in the sequential-id spec, an unrelated sequence name.

The changeset names every removed method and type, says whether upstream offers
a replacement, and records that the removal unblocks the sync. Check the release
consequence before handing it over:

```bash
pnpm changeset status --since=origin/main
```

React's peer range sends `@viu/emporix-sdk-react` to a new major alongside the
SDK — it did in 3.0.0, and the status output for #340 showed it again. Put that
in the PR body: merging it is a decision to ship two majors.

## Verifying it

- `pnpm -F @viu/emporix-sdk fetch:specs` **completes** — that is the proof the
  sync is unblocked. It also rewrites every spec that changed upstream in the
  meantime. Stage the removal first, run it, read the last line, then
  `git checkout -- packages/sdk/specs` to drop the vendoring again: a sync does
  not belong in a breaking PR.
- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- No identifier of the service left in the built `packages/sdk/dist`.
- Re-add the client property on purpose and watch the absence test fail.

## Catching up afterwards

The sync has been blind since the first failure, and the bot's open PR is frozen
at the last green run — often with changes nobody has built facades for yet.
Two ways forward; ask which one the user wants if it is not obvious:

- **Wait.** Merge the removal; the next scheduled run (or
  `gh workflow run api-sync.yml`) refreshes the bot's PR, and the facade work
  follows as in step 1.
- **Catch up now.** A sync-and-facades PR stacked on the removal branch, as #341
  did; it supersedes the bot's PR, which gets closed once it merges. Mind that
  `pr-check.yml` only runs for PRs against `main`: the stacked PR shows nothing
  but the changeset check until it is retargeted, so run the full suite locally
  and say so in its description.
