---
name: emporix-api-sync
description: >
  Brings the vendored Emporix OpenAPI specs level with upstream, measures which
  spec operations the SDK facades do not wrap yet, implements the gaps to this
  repo's standard, and opens a reviewable PR with `gh`. Use this skill whenever
  the work touches Emporix spec or schema drift — "sind die YAMLs noch aktuell",
  "verifiziere ob das Schema neue Endpoints erhalten hat", a link to
  developer.emporix.io/changelog or to emporix/api-references, "welche Endpoints
  fehlen noch", "sync the specs", "is <service> fully covered", a scheduled-sync
  PR that needs review, a failing `Emporix API Sync` workflow ("der tägliche
  Sync-Job schlägt fehl"), or a request to implement a newly documented Emporix
  endpoint. It applies even when the user only wants to *check* one service and
  has not asked for a PR, and even when they name the service instead of the
  spec file.
---

# Emporix API sync

Vendored specs level with upstream, every uncovered operation found, the gaps
built to the repo's standard, one PR a reviewer can check. The deliverable is a
number someone else can reproduce with one command — not an impression.

## The one thing to get right

**Operations are mapped by path literal, never counted.** `11 operations before
and after` is compatible with one being removed and another added. Operation
names lie too: upstream renames `operationId`s, and one facade method can wrap
two operations (a conditional path) or none (a helper). So both sides get
reduced to `METHOD /path/with/{}/placeholders` and set-compared. That is what
`scripts/coverage.mjs` does, and why every claim below is a set difference.

## 1. Find out whether the bot already synced

`.github/workflows/api-sync.yml` runs daily at 06:00 UTC and does the vendoring
for you: it fetches the specs, regenerates types, smoke-tests the bundle, writes
a `patch` changeset and opens or updates **`chore/emporix-api-sync`**.

```bash
gh pr list --head chore/emporix-api-sync --state all --limit 5
gh run list --workflow api-sync.yml --limit 10
```

- **The recent runs are `failure`** → the bot is vendoring nothing, and an open
  sync PR is frozen at the last green run. Read [When the daily sync
  fails](#when-the-daily-sync-fails) first — the three cases below assume a
  working bot.
- **A sync PR is open** → that is the vendoring. Do not re-run `fetch:specs` on
  your own branch and do not push to `chore/emporix-api-sync`; the bot force-owns
  it and you would be fighting a scheduled job. Review that PR, then measure
  coverage against its head and put the facade work in a follow-up branch. That
  is how #327 → #330 and #335 were split.
- **The sync PR was merged recently** → the specs on `main` are already current.
  Skip to step 3; `fetch:specs` will just tell you nothing changed.
- **Neither, or the user asked for a manual check** → sync yourself, step 2.

### When the daily sync fails

`fetch-specs` requests every spec in `SPECS` in order and throws on the first
non-200. One bad spec therefore stops the whole sync, and every spec listed
after it is not even requested — nothing upstream reaches the repo until it is
fixed. Read the failure before changing anything:

```bash
gh run view <run-id> --log-failed | grep -E "Error:|Z fetched " | tail -3
```

- **A network error or a `5xx` in a single run** is transient. Re-run it with
  `gh workflow run api-sync.yml` and carry on.
- **The same `404` run after run** (`Failed to fetch <spec> spec: 404 <url>`) is
  a decision upstream made: the spec was moved or deleted. Those need opposite
  fixes — tell them apart with `references/upstream-removal.md`, which also
  carries the checklist for removing a service. It has happened twice: SEPA
  Export (#302) and Pick-Pack (#340).

Two fixes look tempting and are wrong, for reasons #302 recorded. Making
`fetch-specs` skip a 404: a skipped spec regenerates types without its service
and nobody notices, so the fail-fast stays. And, for a removed service,
keeping the facade against the last vendored spec: its endpoints are gone, so it
becomes a facade that only answers 404 while looking like a working API.

Either way, start clean:

```bash
git status --porcelain
```

Must be empty. A spec file left modified by an earlier `fetch:specs` becomes
part of your diff without appearing in your reasoning — the main checkout of
this repo has sat with four stale spec files exactly this way. Stash or reset
first, then branch `feat/<service>-<what>` (or `chore/<what>` for a
documentation-only follow-up).

## 2. Sync the specs yourself

```bash
pnpm -F @viu/emporix-sdk fetch:specs
```

Its **last line is the authoritative answer** to "did anything change":
`changed since last vendored: media, ai-service` compares a sha256 per service
(`packages/sdk/scripts/sync-manifest.ts`), or `no spec changes since last
vendored` — in which case say so and stop; there is no PR to make.

Never answer that question from `git diff` of `.sync-manifest.json`. Its
`fetchedAt`/`generatedAt` are rewritten on every run, so the manifest shows
~45 changed lines even when no spec byte moved. Reporting drift that did not
exist is the failure mode here; the timestamps are the only thing that moved.

Watch for `⚠ stale patch for <spec>` — upstream fixed a defect
`scripts/spec-patches.ts` was working around, so that patch entry should go.
Then regenerate:

```bash
pnpm -F @viu/emporix-sdk generate
git diff --stat packages/sdk/src/generated
```

The generated diff must touch only the services `fetch:specs` named. Anything
wider means the generator itself moved, which is a separate PR.

## 3. Measure coverage

```bash
node .claude/skills/emporix-api-sync/scripts/coverage.mjs            # all specs
node .claude/skills/emporix-api-sync/scripts/coverage.mjs --spec media
node .claude/skills/emporix-api-sync/scripts/coverage.mjs --json     # for scripting
```

It reports, per spec, `live / covered / missing`, then each uncovered operation
with its `operationId` and OAuth scopes. Three parts of the output are not
decoration:

**`facade paths no spec declares` — explain every line before trusting the
missing list.** A facade path nothing in the specs claims means either the
parser lost a path (so a "missing" entry is a false alarm) or the endpoint
disappeared upstream. Live example: the facade issues `PUT /customer/{}/me`
while the spec declares `PATCH` — printed on both lists. It took a live probe to
explain it (see the table below); an explanation is what each line needs, not a
facade method written to make the line go away.

**`parse health`** — `unresolved path expressions` must be 0. Each one is a
request whose path the parser could not reconstruct, so it is a facade method
counted as absent. Fix the script (or say which method it cannot see) instead
of reporting the gap.

**`AMBIGUOUS`** — two spec paths that differ only in a parameter name collapse
into one key, so a genuine gap could hide behind its covered twin. Has never
fired; if it does, check those two by hand.

Deprecated operations are excluded from `missing` on purpose — the repo wraps
non-deprecated operations — and counted in the footer so the exclusion stays
visible.

### Known gaps that are decisions, not work

Leave these alone; each is documented where it lives.

| Spec | Operations | Why |
|---|---|---|
| `oauth-service` | `POST /oauth/token` | the auth core (`DefaultTokenProvider`) owns it; a facade would duplicate it |
| `customer` | `GET /customerlogin/auth/anonymous/{login,refresh}` | same — implemented in `core/auth.ts`, which this script does not scan |
| `session-context` | the four `/{sessionId}/context…` operations | admin surface over *another* user's session; the JSDoc on `SessionContextService` explains the refusal |
| `iam` | `GET /iam/{tenant}/templates` | legacy-RBAC model, intentionally not wrapped |
| `customer` | `PATCH /customer/{tenant}/me`, `PATCH …/me/addresses/{addressId}` | the facade sends `PUT` to both, so they also show under "facade paths no spec declares". Probed live on 2026-07-24: the API accepts `PUT` and `PATCH` alike — explained, not a gap |

Everything else is work. Measured on `main` at `257ab08` (2026-09-10) and again
at `17ff570` (2026-09-29), the same five operations were uncovered and
**unexplained** — not deliberate, just never built: `iam DELETE /users/{userId}/groups`, `iam GET /users/vendors/{vendorId}`,
`order-v2 HEAD /salesorders`, `order-v2 GET /orders/{orderId}/transitions`,
`shopping-list GET /shopping-lists/{customerId}`. Re-measure rather than trust
that list; if the sync you are doing touches one of those specs, say whether you
filled it instead of letting it pass as normal.

## 4. Read the changelog for what the script cannot see

<https://developer.emporix.io/changelog> and the upstream PRs in
`emporix/api-references`. The script finds missing *paths*. It cannot find:

- **New fields.** Facade types alias the generated ones, so a field becomes
  usable the moment the spec is vendored — no facade diff, no test, nothing to
  build. What it does need is documentation, because nothing else announces it.
- **New behaviour on an existing path.** A new `502`, a validation that now runs
  before a write, a field that turns out to be immutable. This is usually the
  more valuable half of the PR and it shows up as zero missing endpoints.
- **Parameters the facade never sends.** A covered path can still drop what the
  spec reads from the query string: nineteen `POST …/search` methods sent paging
  and sort in the body, where Emporix ignores them, so each returned page one
  forever (#350, #352). For every new or changed operation, compare its
  `in: query` parameters with the facade's request object.

The first two belong in the PR body and in `docs/emporix-upstream-changelog.md`;
the third is a facade fix of its own.

## 5. Implement the gaps

**Zero missing endpoints is a normal, frequent outcome** — the 2026-09-06
indexing sync added none, and the sync before it changed one enum value. Do not
manufacture work to fill the PR. What is left in that case is real but small:
document the new fields and the changed behaviour, add the changelog entry, and
say plainly that the facade already covered everything. If there is no
behavioural change either, there is nothing to ship beyond the bot's own sync PR
— say so.

Read `references/facade-standard.md` — facade method, generated-type aliases,
test, docs, and the traps that reviewers of this repo actually catch.

Scope stays in `packages/sdk`. React and Angular bindings are a separate,
deliberate decision (parity is tracked in `docs/angular.md`); adding hooks in a
sync PR widens the review surface for no reason. Note in the PR that the new
methods have no hooks yet, and let the user decide.

## 6. Verify before you write the PR body

```bash
pnpm build && pnpm typecheck && pnpm lint && pnpm test
```

All four, from the repo root, and `pnpm build` before any example typecheck —
examples compile against `dist/`.

Then break each new behaviour on purpose and prove the right test fails:
comment out the new query parameter, flip the method, drop the header. A test
that passes both ways tests nothing. Restore, re-run, and quote the result.

## 7. Ship it

Read `references/ship-it.md` — changeset, the changelog entry, commit subject
rules, and the `gh pr create` body that makes the diff reviewable.

## Boundaries

- The skill **opens** a PR. It never merges one, never publishes to npm, never
  touches the release PR `changesets/action` maintains.
- Everything committed is English — code, JSDoc, changeset, commit, PR body,
  docs. The conversation stays in whatever language the user is using.
- Endpoints the test tenant's credentials cannot reach stay **unverified against
  a live tenant**, and the PR says so per method rather than implying coverage.
