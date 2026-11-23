# Emporix API Sync Skill in CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After the daily vendoring finds new spec content, GitHub runs the `emporix-api-sync` skill with Claude and turns its result into a follow-up PR or a comment, without a human starting anything.

**Architecture:** `api-sync.yml` gains two jobs after `sync`.
- `skill` gates, then runs Claude with only the read-only `GITHUB_TOKEN`, in a Bash sandbox without network. It hands its commits over as a git bundle with a report.
- `publish` holds the release App token, runs no LLM and no code from the bundle, validates the hand-over and writes the PR or comment.

The decision logic lives in zero-dependency Node scripts under `.github/scripts/api-sync-skill/`, tested with `node --test`; the YAML only wires them.

**Tech Stack:** GitHub Actions, `anthropics/claude-code-action@v1`, Node ≥ 22 built-ins only (`node:test`, `node:child_process`, `node:crypto`, `node:fs`), `gh`, git bundles.

**Spec:** `docs/superpowers/specs/2026-11-23-api-sync-claude-design.md` (branch `feat/api-sync-claude`).

## Global Constraints

- Everything committed is English. Commit subjects follow commitlint: `type(scope): lowercase verb …`, scope `repo` (or `docs`), body lines ≤ 100 characters, no `#N` in a body line.
- Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Scripts under `.github/scripts/api-sync-skill/` import Node built-ins only. The `publish` job runs them with plain `node`, with no `pnpm install`.
- `publish` executes nothing from the bundle and nothing from `base_sha`: it checks out `github.sha` and only fetches the bundle into a ref.
- `skill` job permissions are exactly `contents: read` and `pull-requests: read`. No `id-token`.
- `secrets.CLAUDE_CODE_OAUTH_TOKEN` appears in exactly two places in the workflow: the action step's `claude_code_oauth_token` and the secret check step's `env`.
- Branch names: bot `chore/emporix-api-sync` (never pushed to), follow-up `chore/emporix-api-sync-skill`.
- Marker: `<!-- emporix-api-sync-skill fingerprint=<64 hex> head=<40 hex or -> -->`.
- Modes: the variable `API_SYNC_SKILL` takes `off|rehearsal|live` (unset → `off`). The dispatch input `skill_mode` takes `off|dry|rehearsal|live`, default `off`.
- Allowed paths in the bundle: `packages/sdk/**` except `packages/sdk/package.json`, `docs/**`, `.changeset/**`.
- `MAX_BODY = 65536` characters for a PR body or comment.
- `--model opus`, `--max-turns 80`, `timeout-minutes: 60` (skill), `10` (publish).
- The PR this plan produces touches no published package: label it `no-release`, add no changeset.
- Never push, dispatch a workflow, open a PR or set a repository variable without the user's go in chat (Task 5).

## Review Focus

1. **A failed or timed-out `skill` job.** `publish` must still run, comment the run link on the bot PR and record the fingerprint.
   - The script side is pinned by the `failed skill job` test (Task 2).
   - The YAML side depends on GitHub passing a failed job's step outputs on to a dependent job with `!cancelled()`. No test here exercises that, so the final reviewer checks it against GitHub's docs.
2. **An outcome file that lies.** Possible lies: `ship` with no commits, `nothing` with commits, a rewritten bot commit, a path outside scope. Each one must fail without a push. Pinned by Task 2 tests.
3. **A marker written by a human** in a comment or PR body. It must not suppress a scheduled run, and it must not let the job push over human work. Pinned by the `human marker` test (Task 1) and the `recorded head` tests (Task 2).
4. **An empty or missing OAuth secret in the secret check.** It must fail closed: `grep -F -e ""` matches everything, so the step fails and nothing is uploaded. Pinned by Task 4 Step 6.
5. **A dry run on a feature branch.** It must never open or update the bot PR, and never commit the skill overlay. Pinned by the `sync` guard and the overlay check in Task 4, and proved in Task 5.

---

### Task 1: Shared helpers and the gate

**Files:**
- Create: `.github/scripts/api-sync-skill/shared.mjs`
- Create: `.github/scripts/api-sync-skill/gate.mjs`
- Test: `.github/scripts/api-sync-skill/shared.test.mjs`, `.github/scripts/api-sync-skill/gate.test.mjs`
- Modify: `package.json` (root `scripts`)

**Interfaces:**
- Produces, `shared.mjs`:
  - `BOT_BRANCH = "chore/emporix-api-sync"`, `SKILL_BRANCH = "chore/emporix-api-sync-skill"`, `MAX_BODY = 65536`;
  - `formatMarker({ fingerprint, head }) → string` (`head` null or undefined → `-`);
  - `parseMarkers(text) → Array<{ fingerprint: string, head: string | null }>`;
  - `isReleaseBot(login) → boolean`;
  - `writeOutputs(outputs: Record<string, string>, file = process.env.GITHUB_OUTPUT) → void`;
  - `appendSummary(markdown, file = process.env.GITHUB_STEP_SUMMARY) → void`;
  - `createRunner() → run(cmd: string, args: string[]) → string`, which throws on a non-zero exit.
- Produces, `gate.mjs`:
  - `resolveMode({ eventName, variable, input }) → "off" | "dry" | "rehearsal" | "live"`;
  - `fingerprint(lsTree: string) → string` (64 hex);
  - `changedServices(files: string[]) → string[]`;
  - `decide({ mode, eventName, botPr, fingerprint, seen: string[] }) → { run: boolean, base: "pr" | "main" | null, reason: string }`;
  - `main({ env, run, outDir }) → Promise<Record<"run" | "mode" | "base_sha" | "bot_pr" | "fingerprint", string>>`. It writes `${outDir}/context.json` as `{ mode, baseSha, botPr: { number, title, body, url } | null, changedServices, fingerprint }` when `run` is `"true"`;
  - the CLI entry (when run as a script) calls `main` with `process.env`, `createRunner()` and `outDir = process.env.OUT_DIR`, then `writeOutputs`.

- [ ] **Step 1: Write the failing tests**

`shared.test.mjs` (`import { test } from "node:test"; import assert from "node:assert/strict";`):

```js
const F = "a".repeat(64), H = "b".repeat(40);
test("marker round-trips", () =>
  assert.deepEqual(parseMarkers(`x ${formatMarker({ fingerprint: F, head: H })} y`), [{ fingerprint: F, head: H }]));
test("a missing head renders as - and parses to null", () =>
  assert.deepEqual(parseMarkers(formatMarker({ fingerprint: F })), [{ fingerprint: F, head: null }]));
test("malformed markers are ignored", () =>
  assert.deepEqual(parseMarkers("<!-- emporix-api-sync-skill fingerprint=abc head=- -->"), []));
test("isReleaseBot accepts the app's login forms only", () => {
  for (const l of ["app/viu-release-bot", "viu-release-bot", "viu-release-bot[bot]"]) assert.equal(isReleaseBot(l), true);
  for (const l of ["app/viu-release-bot-evil", "dominic", ""]) assert.equal(isReleaseBot(l), false);
});
test("writeOutputs rejects a multi-line value", () =>
  assert.throws(() => writeOutputs({ a: "x\ny" }, "/dev/null")));
```

`gate.test.mjs`. `fakeRunner(table)` returns a `run` that answers the first entry whose key is a prefix of `[cmd, ...args].join(" ")`, records every call in `run.calls`, and throws on unknown commands.

```js
test("resolveMode", () => {
  const c = (eventName, variable, input) => resolveMode({ eventName, variable, input });
  assert.equal(c("schedule", undefined, undefined), "off");
  assert.equal(c("schedule", "live"), "live");
  assert.equal(c("schedule", "rehearsal"), "rehearsal");
  assert.equal(c("schedule", "dry"), "off");      // dry is dispatch-only
  assert.equal(c("schedule", "LIVE"), "off");     // typos fail safe
  assert.equal(c("workflow_dispatch", "off", "live"), "live");
  assert.equal(c("workflow_dispatch", "live", "off"), "off");
  assert.equal(c("workflow_dispatch", undefined, ""), "off");
  assert.equal(c("push", "live"), "off");
});
const tree = (yml, manifest) =>
  `100644 blob ${yml}\tpackages/sdk/specs/ai-service.yml\n100644 blob ${manifest}\tpackages/sdk/specs/.sync-manifest.json\n`;
test("fingerprint ignores the manifest", () =>
  assert.equal(fingerprint(tree("1".repeat(40), "2".repeat(40))), fingerprint(tree("1".repeat(40), "3".repeat(40)))));
test("fingerprint changes with a spec blob", () =>
  assert.notEqual(fingerprint(tree("1".repeat(40), "2".repeat(40))), fingerprint(tree("4".repeat(40), "2".repeat(40)))));
test("fingerprint is order-independent and fails without specs", () => {
  const a = "100644 blob " + "1".repeat(40) + "\tpackages/sdk/specs/a.yml", b = "100644 blob " + "2".repeat(40) + "\tpackages/sdk/specs/b.yml";
  assert.equal(fingerprint(`${a}\n${b}\n`), fingerprint(`${b}\n${a}\n`));
  assert.throws(() => fingerprint(""));
});
test("changedServices", () =>
  assert.deepEqual(changedServices(["packages/sdk/specs/media.yml", "packages/sdk/specs/.sync-manifest.json",
    "packages/sdk/src/generated/x.ts", "packages/sdk/specs/ai-service.yml"]), ["ai-service", "media"]));
test("decide", () => {
  const pr = { number: 461 };
  assert.deepEqual(decide({ mode: "off", eventName: "schedule", botPr: pr, fingerprint: F, seen: [] }).run, false);
  assert.deepEqual(decide({ mode: "dry", eventName: "workflow_dispatch", botPr: null, fingerprint: F, seen: [] }), { run: true, base: "main", reason: "no open sync PR; dry run on main" });
  assert.equal(decide({ mode: "live", eventName: "workflow_dispatch", botPr: null, fingerprint: F, seen: [] }).run, false);
  assert.equal(decide({ mode: "live", eventName: "schedule", botPr: pr, fingerprint: F, seen: [F] }).run, false);
  assert.equal(decide({ mode: "live", eventName: "workflow_dispatch", botPr: pr, fingerprint: F, seen: [F] }).run, true);
  assert.equal(decide({ mode: "live", eventName: "schedule", botPr: pr, fingerprint: F, seen: [] }).base, "pr");
});
```

`main` tests use the fake runner with these keys:
- `gh pr list --repo R --head chore/emporix-api-sync` → JSON list of `{ number, headRefOid, title, body, url, author: { login }, files: [{ path }] }`;
- `git rev-parse refs/remotes/origin/main` → a SHA;
- `git ls-tree -r <sha> -- packages/sdk/specs` → a tree;
- `gh pr list --repo R --head chore/emporix-api-sync-skill` → `[{ body, comments: [{ author: { login }, body }] }]`;
- `gh pr view 461 --repo R --json comments` → `{ comments: [...] }`.

The tests and what each asserts:
- **`scheduled live run on new content`:** `{ run: "true", base_sha: <pr head>, bot_pr: "461" }`. `context.json` has `changedServices: ["ai-service"]`.
- **`scheduled run already handled`:** `run` is `"false"` when a release-bot comment on the bot PR carries the fingerprint's marker.
- **`human marker does not suppress`:** the same marker in a comment by `dominic` gives `run` `"true"`.
- **`dry dispatch without a sync PR`:** `base_sha` is the `origin/main` SHA, `bot_pr` is `""`.
- **`dispatch never reads markers`:** no call starts with `gh pr list --repo R --head chore/emporix-api-sync-skill`.
- **`bot PR by another author is ignored`:** a PR whose `author.login` is `dominic` counts as no sync PR.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test ".github/scripts/**/*.test.mjs"`
Expected: FAIL, with `ERR_MODULE_NOT_FOUND` for `shared.mjs` and `gate.mjs`.

- [ ] **Step 3: Implement `shared.mjs` and `gate.mjs`**

- `fingerprint`: sort the `.yml` lines by path, then take sha256 over the `"<oid> <path>\n"` lines.
- `main` passes `--repo ${env.GITHUB_REPOSITORY}` to every `gh` call. It creates `outDir` if it is missing, because it runs before any other step of the job.
- `seen` = the fingerprints parsed from:
  - the latest skill-branch PR body;
  - that PR's comments by the release bot;
  - the bot PR's comments by the release bot.

  It is read on `schedule` only.
- The CLI guard is `if (import.meta.url === pathToFileURL(process.argv[1]).href)`.

- [ ] **Step 4: Wire the tests into `pnpm test`**

Root `package.json`:
- add `"test:ci-scripts": "node --test \".github/scripts/**/*.test.mjs\""`;
- append ` && pnpm test:ci-scripts` to `"test"`.

`pr-check.yml` runs `pnpm test`, so CI picks them up.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test:ci-scripts`
Expected: PASS, every test in both files, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add .github/scripts/api-sync-skill package.json
git commit -m "feat(repo): add the gate for the api sync skill run" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The publish decision and its writes

**Files:**
- Create: `.github/scripts/api-sync-skill/publish.mjs`
- Test: `.github/scripts/api-sync-skill/publish.test.mjs`

**Interfaces:**
- Consumes: everything from `shared.mjs` (Task 1).
- Produces:
  - `validateOutcome(raw: string) → { ok: true, value: { outcome: "ship" | "nothing", title: string, checks: "pass" | "fail" } } | { ok: false, error: string }`;
  - `offendingPaths(files: string[]) → string[]`;
  - `hasHumanWork({ reviewCount: number, remoteHead: string | null, recordedHead: string | null }) → boolean`;
  - `decidePublish({ mode, skillResult, artifact: boolean, validation, commitCount, ancestorOk, offending, bodyLength, existingPr }) → { kind: "summary" | "pr" | "comment-bot" | "comment-skill-pr" | "failed", draft: boolean, reason: string }`;
  - `main({ env, run, artifactDir, tmpDir }) → Promise<{ kind, reason }>`.
- `env` keys: `MODE`, `BASE_SHA`, `BOT_PR`, `FINGERPRINT`, `SKILL_RESULT`, `RUN_URL`, `GITHUB_REPOSITORY`. The CLI exits 1 when `reason` is non-empty.

- [ ] **Step 1: Write the failing tests**

```js
test("validateOutcome", () => {
  assert.equal(validateOutcome('{"outcome":"ship","title":"feat(sdk): add x","checks":"pass"}').ok, true);
  assert.equal(validateOutcome('{"outcome":"nothing","title":"","checks":"pass"}').ok, true);
  for (const bad of ["not json", '{"outcome":"merge","title":"t","checks":"pass"}',
    '{"outcome":"ship","title":"","checks":"pass"}', '{"outcome":"ship","title":"a\\nb","checks":"pass"}',
    '{"outcome":"ship","title":"t","checks":"maybe"}', '{"outcome":"ship","title":"' + "t".repeat(201) + '","checks":"pass"}'])
    assert.equal(validateOutcome(bad).ok, false, bad);
});
test("offendingPaths", () => {
  assert.deepEqual(offendingPaths(["packages/sdk/src/a.ts", "docs/x.md", ".changeset/y.md"]), []);
  assert.deepEqual(offendingPaths([".github/workflows/x.yml", "packages/react/src/a.ts",
    "packages/sdk/package.json", ".claude/skills/emporix-api-sync/SKILL.md"]),
    [".github/workflows/x.yml", "packages/react/src/a.ts", "packages/sdk/package.json", ".claude/skills/emporix-api-sync/SKILL.md"]);
});
test("hasHumanWork", () => {
  assert.equal(hasHumanWork({ reviewCount: 0, remoteHead: H, recordedHead: H }), false);
  assert.equal(hasHumanWork({ reviewCount: 1, remoteHead: H, recordedHead: H }), true);
  assert.equal(hasHumanWork({ reviewCount: 0, remoteHead: "c".repeat(40), recordedHead: H }), true);
  assert.equal(hasHumanWork({ reviewCount: 0, remoteHead: null, recordedHead: null }), false);
});
```

`main` tests use a recording fake runner, as in Task 1, with a temp `artifactDir` per test. Write `outcome.json`, `report.md` and, for `ship`, a placeholder `work.bundle` (the runner answers git calls, so the file need not be a real bundle). The runner answers:
- `git fetch <bundle> refs/heads/skill-work:refs/remotes/skill/work`;
- `git rev-parse refs/remotes/skill/work` → `H`;
- `git rev-list --count BASE..H` → the commit count;
- `git merge-base --is-ancestor BASE H` → `""`, or throws for "not an ancestor";
- `git diff --name-only BASE H` → paths;
- `git ls-remote origin refs/heads/chore/emporix-api-sync-skill` → `""` or `"<sha>\trefs/heads/…"`;
- `gh pr list --repo R --head chore/emporix-api-sync-skill --state open` → `[]` or `[{ number, body, isDraft, reviews }]`.

"Writes" means any call to:
- `git push`;
- `gh pr create`, `gh pr edit`, `gh pr comment` or `gh pr ready`.

The tests and what each asserts:
- **`dry ship writes nothing`:** no writes, and `kind` is `"summary"`.
- **`dry failure writes nothing`:** a failed `SKILL_RESULT` in dry mode gives no writes, `kind` `"summary"` and a non-empty `reason`.
- **`live ship without a PR`:**
  - `git push --force-with-lease=refs/heads/chore/emporix-api-sync-skill: origin H:refs/heads/chore/emporix-api-sync-skill`;
  - then `gh pr create --repo R --base main --head chore/emporix-api-sync-skill --title <title> --body-file <f>`, without `--draft`;
  - the body file contains `Includes the vendoring of #461. Merging this PR supersedes it.` and `formatMarker({ fingerprint: F, head: H })`.
- **`rehearsal ship`:** `gh pr create … --draft`, and the title starts with `[rehearsal] `.
- **`checks fail on an existing ready PR`:** the push uses lease `:<recorded head>`, then `gh pr edit 470 …`, then `gh pr ready 470 --undo`.
- **`existing PR with a review`:** a review gives no push and `gh pr comment <skill PR> --body-file`; the body contains the marker.
- **`recorded head differs`:** remote head ≠ the last marker's `head` in the PR body gives no push and a comment on the skill PR.
- **`nothing`:** `gh pr comment 461 --body-file`, and the body is the report plus `formatMarker({ fingerprint: F })`.
- **`failed skill job`:**
  - with `SKILL_RESULT=failure` and no artifact: `gh pr comment 461`;
  - the body contains `RUN_URL`, the words `skill_mode: live` and the marker;
  - the result has a non-empty `reason`.
- **`ship without commits`, `nothing with commits`, `not an ancestor`, `path outside scope`, `report too long`:** each gives no push, a comment on 461, and a `reason` naming the cause.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test .github/scripts/api-sync-skill/publish.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `publish.mjs`.

- [ ] **Step 3: Implement `publish.mjs`**

`decidePublish` checks in this order, and the first hit is the `reason`:
1. skill job not `success`, or no artifact;
2. invalid outcome;
3. `ship` with no commits, or `nothing` with commits;
4. not an ancestor;
5. offending paths;
6. body over `MAX_BODY`.

Then:
- `dry` → `summary`, with the reason if any;
- a reason → `failed`;
- `nothing` → `comment-bot`;
- `ship` with `hasHumanWork` → `comment-skill-pr`;
- otherwise `pr`, with `draft = mode === "rehearsal" || checks === "fail"`.

Further rules:
- `recordedHead` is the `head` of the last marker in the existing PR body.
- Bodies are written to `tmpDir` and passed with `--body-file`.
- A `rehearsal` comment starts with `[rehearsal] `.
- Every kind also calls `appendSummary` with kind, reason and outcome.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test:ci-scripts`
Expected: PASS, all three files, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add .github/scripts/api-sync-skill/publish.mjs .github/scripts/api-sync-skill/publish.test.mjs
git commit -m "feat(repo): add the publish step for the api sync skill run" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The skill's CI section

**Files:**
- Modify: `.claude/skills/emporix-api-sync/SKILL.md`

**Interfaces:**
- Consumes:
  - `context.json` from Task 1, with the shape `{ mode, baseSha, botPr, changedServices, fingerprint }`;
  - the `outcome.json` shape that `validateOutcome` accepts (Task 2).
- Produces: the section «Running unattended in CI», which Task 4's prompt names verbatim.

- [ ] **Step 1: Add the section «Running unattended in CI»** at the end of `SKILL.md`, before «Boundaries». It carries the spec's bullets (Design → The skill's CI section). In addition:
  - **Outputs:** write `report.md` (the PR body or comment) and `outcome.json` (`{"outcome": "ship" | "nothing", "title": "<commit-style title, ≤ 200 chars>", "checks": "pass" | "fail"}`) to the output directory the prompt names. Never write them inside the checkout.
  - **Commits:** commit on the checked-out branch `skill-work`, with commitlint subjects; the hooks run.
  - **Dry mode only, sandbox probes:** run these three commands exactly and put each one-word answer into `report.md` under «Sandbox probes». Expected: `false`, `false`, `blocked`. Never print an environment value.

    ```
    pnpm -F @viu/emporix-sdk exec node -e "console.log('CLAUDE_CODE_OAUTH_TOKEN' in process.env)"
    pnpm -F @viu/emporix-sdk exec node -e "const fs=require('fs');let hit=false;for(const p of fs.readdirSync('/proc')){if(!/^\d+$/.test(p))continue;try{if(fs.readFileSync('/proc/'+p+'/environ','latin1').includes('sk-ant-'))hit=true}catch{}}console.log(hit)"
    pnpm -F @viu/emporix-sdk exec node -e "fetch('https://example.com').then(()=>console.log('open'),()=>console.log('blocked'))"
    ```

- [ ] **Step 2: Point local runs at CI's work** in step 1 of `SKILL.md`, after the `gh pr list --head chore/emporix-api-sync` block. Add one line: CI may already have opened the follow-up PR, so check `gh pr list --head chore/emporix-api-sync-skill --state all --limit 3` and review that PR rather than redoing it.

- [ ] **Step 3: Verify**

Run: `grep -c "Running unattended in CI" .claude/skills/emporix-api-sync/SKILL.md && grep -c "chore/emporix-api-sync-skill" .claude/skills/emporix-api-sync/SKILL.md`
Expected: `1`, then ≥ `2`.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/emporix-api-sync/SKILL.md
git commit -m "docs(repo): teach the api sync skill to run unattended in ci" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Wire the jobs into `api-sync.yml`

**Files:**
- Modify: `.github/workflows/api-sync.yml`
- Create: `.github/scripts/api-sync-skill/claude-settings.json`

**Interfaces:**
- Consumes:
  - `gate.mjs` CLI outputs `run`, `mode`, `base_sha`, `bot_pr` and `fingerprint` (Task 1);
  - `publish.mjs` CLI with the env keys from Task 2;
  - the CI section name from Task 3.
- Produces: the artifact `api-sync-skill`, which contains `work.bundle` (only with commits), `report.md`, `outcome.json`, and in dry mode `execution.json`.

- [ ] **Step 1: Write `claude-settings.json`** with exactly these keys:

```json
{
  "sandbox": {
    "enabled": true,
    "failIfUnavailable": true,
    "allowUnsandboxedCommands": false,
    "network": { "allowedDomains": [] },
    "credentials": {
      "envVars": [
        { "name": "CLAUDE_CODE_OAUTH_TOKEN", "mode": "deny" },
        { "name": "GITHUB_TOKEN", "mode": "deny" },
        { "name": "GH_TOKEN", "mode": "deny" },
        { "name": "ACTIONS_RUNTIME_TOKEN", "mode": "deny" },
        { "name": "ACTIONS_ID_TOKEN_REQUEST_TOKEN", "mode": "deny" }
      ]
    }
  },
  "permissions": { "deny": ["Read(//proc/**)"] }
}
```

- [ ] **Step 2: Change the triggers and `sync`**

- `on.workflow_dispatch.inputs.skill_mode`: `type: choice`, `options: [off, dry, rehearsal, live]`, `default: off`.
- `jobs.sync.if: github.ref == 'refs/heads/main'`.
- `jobs.sync.outputs.has_changes: ${{ steps.detect.outputs.has_changes }}`.

Change nothing else in `sync`.

- [ ] **Step 3: Add the job `skill`**

Job settings:
- `needs: sync`;
- `if: ${{ !cancelled() && (needs.sync.outputs.has_changes == 'true' || github.event_name == 'workflow_dispatch') }}`;
- `runs-on: ubuntu-latest`, `timeout-minutes: 60`;
- `permissions: { contents: read, pull-requests: read }`;
- `outputs`: `run`, `mode`, `base_sha`, `bot_pr` and `fingerprint`, each from `steps.gate.outputs`.
- `env`: `OUT_DIR: ${{ runner.temp }}/api-sync-skill`, `PKG_DIR: ${{ runner.temp }}/api-sync-skill-artifact`, `CFG_DIR: ${{ runner.temp }}/api-sync-skill-config`.

Steps, in order. From step 3 on, every step has `if: steps.gate.outputs.run == 'true'`; steps 8 to 10 instead have `if: always() && steps.gate.outputs.run == 'true'`, with the extra condition step 10 names:

1. `actions/checkout@v7` with `fetch-depth: 0` and `persist-credentials: false`, at the default ref (`github.sha`).
2. `actions/setup-node@v7` with `node-version-file: .nvmrc`.
3. `id: gate`: `node .github/scripts/api-sync-skill/gate.mjs`, with env:
   - `GH_TOKEN: ${{ github.token }}`;
   - `API_SYNC_SKILL: ${{ vars.API_SYNC_SKILL }}`;
   - `SKILL_MODE: ${{ inputs.skill_mode }}`.

   This step has no `if`.
4. **Check out the base with the workflow's skill.** A shell step with env `BASE_SHA` from the gate:

   ```bash
   mkdir -p "$OUT_DIR" "$PKG_DIR" "$CFG_DIR"
   cp .github/scripts/api-sync-skill/claude-settings.json "$CFG_DIR/"
   git checkout -q --detach "$BASE_SHA"
   git checkout -q "$GITHUB_SHA" -- .claude/skills/emporix-api-sync
   git reset -q -- .claude/skills/emporix-api-sync
   git ls-files -m -- .claude/skills/emporix-api-sync | xargs -r git update-index --skip-worktree
   git ls-files -o --exclude-standard -- .claude/skills/emporix-api-sync >> .git/info/exclude
   test -z "$(git status --porcelain)"   # the overlay is invisible to git add
   git switch -q -c skill-work
   git config user.name "emporix-api-sync-skill"
   git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
   ```

   `context.json` must already be in `$OUT_DIR`; the gate wrote it there.
5. `pnpm/action-setup@v6`, then `actions/setup-node@v7` with `cache: pnpm`, then `pnpm install --frozen-lockfile` and `pnpm build`.
6. **Sandbox dependencies**, with no `continue-on-error`:

   ```bash
   sudo apt-get update -qq
   sudo apt-get install -y --no-install-recommends bubblewrap socat
   if [ -f /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]; then
     sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
   fi
   ```

7. `id: claude`, `uses: anthropics/claude-code-action@v1`, with step `env: CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1"` and these inputs:

   ```yaml
   claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
   github_token: ${{ github.token }}
   settings: ${{ runner.temp }}/api-sync-skill-config/claude-settings.json
   prompt: |
     /emporix-api-sync
     CI mode: follow "Running unattended in CI" in the skill.
     Mode: ${{ steps.gate.outputs.mode }}
     Context file: ${{ runner.temp }}/api-sync-skill/context.json
     Output directory: ${{ runner.temp }}/api-sync-skill
   claude_args: >-
     --permission-mode default --model opus --max-turns 80
     --add-dir ${{ runner.temp }}/api-sync-skill
     --allowedTools "Read,Edit,Write,Glob,Grep,Skill,Bash(pnpm build:*),Bash(pnpm typecheck:*),Bash(pnpm lint:*),Bash(pnpm test:*),Bash(pnpm -F @viu/emporix-sdk:*),Bash(pnpm changeset status:*),Bash(node .claude/skills/emporix-api-sync/scripts/coverage.mjs:*),Bash(git status:*),Bash(git diff:*),Bash(git log:*),Bash(git show:*),Bash(git add:*),Bash(git commit:*),WebFetch(domain:developer.emporix.io),WebFetch(domain:github.com),WebFetch(domain:raw.githubusercontent.com)"
   ```

8. **Package.** If `git rev-list --count "$BASE_SHA..skill-work"` is > 0, run `git bundle create "$PKG_DIR/work.bundle" "$BASE_SHA..skill-work"`. Copy `report.md` and `outcome.json` from `$OUT_DIR` to `$PKG_DIR` where they exist. In dry mode, also copy `steps.claude.outputs.execution_file` to `$PKG_DIR/execution.json`.
9. `id: secret`, the secret check. Its step env is `TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}` and `BASE_SHA`.
   - Write a haystack file first, so `pipefail` cannot hide a hit: `{ git log --format=%B "$BASE_SHA..skill-work"; git diff --text "$BASE_SHA" skill-work; for f in report.md outcome.json execution.json; do if [ -f "$PKG_DIR/$f" ]; then cat "$PKG_DIR/$f"; fi; done; } > "$RUNNER_TEMP/haystack"`.
   - Then `if grep -qF -e "$TOKEN" "$RUNNER_TEMP/haystack"; then echo "::error::The result contains the OAuth token; nothing is uploaded."; exit 1; fi`, and remove the file.
   - The step never echoes `$TOKEN` or a matched line.
10. `actions/upload-artifact@v7`, with the extra condition `steps.secret.outcome == 'success'`. Inputs: `name: api-sync-skill`, `path: ${{ runner.temp }}/api-sync-skill-artifact`, `retention-days: 7`, `if-no-files-found: ignore`.

- [ ] **Step 4: Add the job `publish`**

Job settings:
- `needs: skill`;
- `if: ${{ !cancelled() && needs.skill.outputs.run == 'true' }}`;
- `runs-on: ubuntu-latest`, `timeout-minutes: 10`;
- `permissions: { contents: read }`.

Steps:
1. `actions/create-github-app-token@v3` as in `sync`.
2. `actions/checkout@v7` with the App token and `fetch-depth: 0`, at the default ref.
3. `actions/setup-node@v7` with `node-version-file: .nvmrc` and no cache.
4. `actions/download-artifact` at the major that pairs with `upload-artifact@v7` (check its release notes), with `name: api-sync-skill`, `path: ${{ runner.temp }}/api-sync-skill-artifact` and `continue-on-error: true`.
5. `node .github/scripts/api-sync-skill/publish.mjs`, with env:
   - `GH_TOKEN` (App token), `HUSKY: "0"`;
   - `MODE`, `BASE_SHA`, `BOT_PR` and `FINGERPRINT` from `needs.skill.outputs`;
   - `SKILL_RESULT: ${{ needs.skill.result }}`;
   - `ARTIFACT_DIR`;
   - `RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}`.

- [ ] **Step 5: Add a header comment** to `api-sync.yml` explaining the jobs: what `skill` and `publish` do, the modes, why `skill` holds no write token, and why `sync` runs only on `main`.

- [ ] **Step 6: Static checks**

Run:

```bash
grep -c "secrets.CLAUDE_CODE_OAUTH_TOKEN" .github/workflows/api-sync.yml
grep -c "id-token" .github/workflows/api-sync.yml
grep -n "skill_mode\|API_SYNC_SKILL\|CLAUDE_CODE_SUBPROCESS_ENV_SCRUB\|refs/heads/main" .github/workflows/api-sync.yml
pnpm test:ci-scripts
```

Expected:
- `2`, then `0`;
- one or more lines for each of the four names;
- tests PASS.

Then confirm the empty-token behaviour of step 9 locally. `printf 'abc' > /tmp/h; TOKEN=""; grep -qF -e "$TOKEN" /tmp/h && echo hit` prints `hit`.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/api-sync.yml .github/scripts/api-sync-skill/claude-settings.json
git commit -m "feat(repo): run the api sync skill with claude after the daily sync" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Dry run on GitHub (needs the user's go)

**Files:** none, unless the run disproves something. Then fix the file the finding names, and add a Ruling to the ledger and a line to the spec.

- [ ] **Step 1: Stop and ask the user** before pushing `feat/api-sync-claude` and dispatching. Both are outward actions.

- [ ] **Step 2: Push and dispatch the dry run**

```bash
git push -u origin feat/api-sync-claude
gh workflow run api-sync.yml --ref feat/api-sync-claude -f skill_mode=dry
```

Expected: the run is accepted. If GitHub refuses the inputs on a non-default branch, follow the spec's fallback: merge with `API_SYNC_SKILL` unset, then dispatch `dry` from `main`. That needs the user's go again.

- [ ] **Step 3: Read the run** with `gh run view <id> --log` and the job summary. Each item must hold:
  - `sync` is skipped;
  - `skill` ran with `contents: read` and `pull-requests: read` only (see the «GITHUB_TOKEN Permissions» log group);
  - the overlay check passed;
  - Claude invoked the skill, and coverage and `pnpm` ran;
  - the report shows the probes `false`, `false`, `blocked`;
  - the secret check passed, and the artifact exists;
  - `publish` ran, wrote only the summary, and made no `git push` and no `gh pr` writes.

- [ ] **Step 4: Inspect the execution file** from the artifact. No tool outside the allowlist ran, no `Bash` call ran unsandboxed, and no `gh` call came from Claude.

- [ ] **Step 5: Record the outcome.**
  - Ledger: one line per check in Step 3 with its result.
  - Spec: if a layer had to be dropped (for example, the sandbox does not start on hosted runners), write its gap under «Secret protection» as an accepted risk. Commit with `docs(repo): record the api sync dry run findings`.

Rehearsal, gate and live (spec «Verification» 2–5) happen after the merge and are the user's: they set `API_SYNC_SKILL` and dispatch `rehearsal`.
