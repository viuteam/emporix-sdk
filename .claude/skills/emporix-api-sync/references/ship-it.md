# Ship it

Changeset, changelog entry, commit, PR. The PR is where the measurement becomes
reviewable, so it gets the same care as the code.

## Changeset

Write `.changeset/<kebab-name>.md` directly — `pnpm changeset` is interactive
and there is nothing it decides that you do not already know:

```markdown
---
"@viu/emporix-sdk": minor
---

feat(sdk): add media.patch and ai.reuseAttachment for the 2026-09-10 spec changes

<prose: what a consumer can now do, and what changed in behaviour>
```

- **`minor`** for new methods or new reachable API surface, **`patch`** for docs,
  JSDoc and fixes. The bot's sync changeset is `patch` and its own PR body says
  to raise it to `minor` when the sync turns out to be additive surface — if you
  are the one implementing that surface, the bump belongs on your changeset.
- The first line repeats the commit subject; the body is the user-visible
  effect, not the file list. `.changeset/indexing-sort-and-credential-validation.md`
  is the length and tone that fits this repo.
- `@viu/emporix-examples-*` are in `.changeset/config.json` `ignore` — never
  list them.

**Never park an empty changeset on `main`.** `changesets/action` returns without
versioning *or* publishing while every changeset is empty, so the next real
release sits inert until someone notices. For a change that cannot affect the
published packages — tests only, CI only — use the **`no-release`** label
instead; `changeset-check.yml` skips the gate entirely when it is present.

Checking the gate locally has two traps:

```bash
git add -N .changeset/<name>.md          # untracked files are invisible to it
pnpm changeset status --since=origin/main
```

A root-level change like `pnpm-lock.yaml` touches no package, so `status` exits
0 with no changeset at all — green here does not mean the gate is satisfied for
a package change.

## `docs/emporix-upstream-changelog.md`

The human-readable half of the sync log (the machine half is
`packages/sdk/specs/.sync-manifest.json`). Newest entry first:

```markdown
## 2026-09-10 — media, ai-service: asset JSON-Patch, attachment reuse

Vendored by <PR link>. **2 new endpoints, 0 removed, 0 newly deprecated** —
measured by mapping operations on path literal, not by count.

### Endpoints
- **media** — new `PATCH /media/{tenant}/assets/{assetId}` … SDK: added
  `client.media.patch`. The facade now covers all 7 operations.

### Fields
Nothing to build — the facade types alias the generated ones, so these arrived
with the sync. They did need documenting:

| Where | Field | Note |
|---|---|---|

### Behaviour
<status codes, validation order, immutability — the half no endpoint count shows>
```

State the counts as `N new, N removed, N newly deprecated` **and how they were
measured**. That sentence is what lets the next person believe the number
without redoing the work — and it is the difference between this file and a
list of commits.

## Commit

Commitlint is enforced by husky (`commitlint.config.js`, `.husky/commit-msg`):

- scope from the allowlist: `repo, release, sdk, react, core, customer, product,
  category, cart, checkout, payment, price, media, segment, availability, auth,
  http, logger, deps, docs, examples`
- **first word after the scope is a lowercase verb** — `feat(sdk): add …` ✓,
  `feat(sdk): Add …` ✗. A capitalised filename in the subject trips it too.

The pre-commit hook runs lint + repo-wide typecheck. If it fails on a merge
commit, fix the code and commit the merge together with the fix — reaching for
`--no-verify` hands the failure to CI, or worse, to `main`.

## PR

```bash
gh pr create --base main --title "<commit subject>" --body-file <scratchpad>/pr-body.md
```

Write the body to a file first; a heredoc through the shell mangles backticks
and tables. What makes it reviewable:

1. **What changed upstream**, linked — the Emporix changelog entry and the
   `emporix/api-references` PR when you can find it.
2. **The counts, and the command that reproduces them.** `node
   .claude/skills/emporix-api-sync/scripts/coverage.mjs --spec media` in a fenced
   block with its output beats any prose claim of completeness.
3. **A table of what was added**: method, path, scope, and the facade method
   that now wraps it.
4. **What arrived without a diff** — new fields reachable through the type
   aliases, and new behaviour on existing paths. Reviewers cannot see these in
   the diff, so if the body omits them they are lost.
5. **What was deliberately left out, and why.** Hooks in `packages/react` /
   `packages/angular`; operations on the known-exclusions list; anything the
   test tenant's credentials cannot reach, named per method as **unverified
   against a live tenant**. Silence here reads as coverage.
6. **Verification**: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`
   with their result, plus which test you broke on purpose to prove it fails.

Close with the generated-by line the repo uses:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## Stop here

Opening the PR is the end of this skill. Merging it, publishing to npm,
touching the `changeset-release/main` PR, or pushing to the bot's
`chore/emporix-api-sync` branch are all the user's calls, not this workflow's.
Post the PR link and say what a reviewer should look at first.
