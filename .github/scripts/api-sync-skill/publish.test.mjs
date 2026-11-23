import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { validateOutcome, offendingPaths, hasHumanWork, changedPaths, main } from "./publish.mjs";
import { createRunner, formatMarker } from "./shared.mjs";
import { fakeRunner } from "./test-helpers.mjs";

const BOT = { login: "app/viu-release-bot" };

const F = "a".repeat(64);
const H = "b".repeat(40);
const BASE = "e".repeat(40);
const RECORDED = "f".repeat(40);
const RUN_URL = "https://github.com/R/actions/runs/1";

test("validateOutcome", () => {
  assert.equal(validateOutcome('{"outcome":"ship","title":"feat(sdk): add x","checks":"pass"}').ok, true);
  assert.equal(validateOutcome('{"outcome":"nothing","title":"","checks":"pass"}').ok, true);
  for (const bad of [
    "not json",
    '{"outcome":"merge","title":"t","checks":"pass"}',
    '{"outcome":"ship","title":"","checks":"pass"}',
    '{"outcome":"ship","title":"a\\nb","checks":"pass"}',
    '{"outcome":"ship","title":"t","checks":"maybe"}',
    '{"outcome":"ship","title":"' + "t".repeat(201) + '","checks":"pass"}',
  ]) {
    assert.equal(validateOutcome(bad).ok, false, bad);
  }
});

test("offendingPaths", () => {
  assert.deepEqual(offendingPaths(["packages/sdk/src/a.ts", "docs/x.md", ".changeset/y.md"]), []);
  const bad = [
    ".github/workflows/x.yml",
    "packages/react/src/a.ts",
    "packages/sdk/package.json",
    ".claude/skills/emporix-api-sync/SKILL.md",
  ];
  assert.deepEqual(offendingPaths(bad), bad);
});

test("hasHumanWork", () => {
  assert.equal(hasHumanWork({ reviewCount: 0, remoteHead: H, recordedHead: H }), false);
  assert.equal(hasHumanWork({ reviewCount: 1, remoteHead: H, recordedHead: H }), true);
  assert.equal(hasHumanWork({ reviewCount: 0, remoteHead: "c".repeat(40), recordedHead: H }), true);
  assert.equal(hasHumanWork({ reviewCount: 0, remoteHead: null, recordedHead: null }), false);
});

// --- main ---------------------------------------------------------------------

const SHIP = { outcome: "ship", title: "feat(sdk): add media upload sessions", checks: "pass" };
const NOTHING = { outcome: "nothing", title: "", checks: "pass" };

/** An artifact directory; `bundle: false` leaves out work.bundle, `outcome: null` leaves out everything. */
function artifact({ outcome = SHIP, report = "## Report\nAdded two facades.", bundle = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "publish-art-"));
  if (outcome !== null) {
    writeFileSync(join(dir, "outcome.json"), JSON.stringify(outcome));
    writeFileSync(join(dir, "report.md"), report);
    if (bundle) writeFileSync(join(dir, "work.bundle"), "placeholder");
  }
  return dir;
}

function table({
  commits = 2,
  ancestor = true,
  paths = ["packages/sdk/src/services/media.ts", ".changeset/media.md"],
  remote = "",
  skillPrs = [],
} = {}) {
  return [
    ["git fetch", ""],
    ["git rev-parse refs/remotes/skill/work", H],
    ["git rev-list --count", String(commits)],
    [
      "git merge-base --is-ancestor",
      () => {
        if (!ancestor) throw new Error("exit 1");
        return "";
      },
    ],
    ["git diff --name-only", paths.join("\0")],
    ["git ls-remote origin refs/heads/chore/emporix-api-sync-skill", remote],
    ["gh pr list --repo R --head chore/emporix-api-sync-skill --state open", JSON.stringify(skillPrs)],
    ["git push", ""],
    ["gh pr create", ""],
    ["gh pr edit", ""],
    ["gh pr ready", ""],
    ["gh pr comment", ""],
  ];
}

const env = (over) => ({
  MODE: "live",
  BASE_SHA: BASE,
  BOT_PR: "461",
  FINGERPRINT: F,
  SKILL_RESULT: "success",
  RUN_URL,
  GITHUB_REPOSITORY: "R",
  ...over,
});

const WRITE = /^(git push|gh pr (create|edit|comment|ready))\b/;
const writes = (run) => run.calls.filter((c) => WRITE.test(c));
/** Reads the file named after `--body-file` in a call. */
const bodyOf = (call) => readFileSync(call.match(/--body-file (\S+)/)[1], "utf8");

async function publish({ envOver, art, tableOpts } = {}) {
  const run = fakeRunner(table(tableOpts));
  const result = await main({
    env: env(envOver),
    run,
    artifactDir: art ?? artifact(),
    tmpDir: mkdtempSync(join(tmpdir(), "publish-tmp-")),
  });
  return { run, result };
}

test("dry ship writes nothing", async () => {
  const { run, result } = await publish({ envOver: { MODE: "dry" } });
  assert.deepEqual(writes(run), []);
  assert.equal(result.kind, "summary");
  assert.equal(result.reason, "");
});

test("dry failure writes nothing", async () => {
  const { run, result } = await publish({ envOver: { MODE: "dry", SKILL_RESULT: "failure" }, art: artifact({ outcome: null }) });
  assert.deepEqual(writes(run), []);
  assert.equal(result.kind, "summary");
  assert.match(result.reason, /skill job: failure/);
});

test("live ship without a PR", async () => {
  const { run, result } = await publish();
  const w = writes(run);
  assert.equal(result.kind, "pr");
  assert.equal(
    w[0],
    `git push --force-with-lease=refs/heads/chore/emporix-api-sync-skill: origin ${H}:refs/heads/chore/emporix-api-sync-skill`,
  );
  assert.match(
    w[1],
    /^gh pr create --repo R --base main --head chore\/emporix-api-sync-skill --title feat\(sdk\): add media upload sessions --body-file \S+$/,
  );
  const body = bodyOf(w[1]);
  assert.match(body, /Added two facades\./);
  assert.ok(body.includes("Includes the vendoring of #461. Merging this PR supersedes it."));
  assert.ok(body.includes(formatMarker({ fingerprint: F, head: H })));
  assert.equal(w.length, 2);
});

test("rehearsal ship", async () => {
  const { run } = await publish({ envOver: { MODE: "rehearsal" } });
  const create = writes(run).find((c) => c.startsWith("gh pr create"));
  assert.match(create, / --title \[rehearsal\] feat\(sdk\)/);
  assert.match(create, / --draft$/);
});

test("checks fail on an existing ready PR", async () => {
  const skillPrs = [{ number: 470, author: BOT, body: `old\n${formatMarker({ fingerprint: "c".repeat(64), head: RECORDED })}`, isDraft: false, reviews: [] }];
  const { run, result } = await publish({
    art: artifact({ outcome: { ...SHIP, checks: "fail" } }),
    tableOpts: { remote: `${RECORDED}\trefs/heads/chore/emporix-api-sync-skill`, skillPrs },
  });
  const w = writes(run);
  assert.equal(result.kind, "pr");
  assert.match(w[0], new RegExp(`^git push --force-with-lease=refs/heads/chore/emporix-api-sync-skill:${RECORDED} `));
  assert.match(w[1], /^gh pr edit 470 /);
  assert.ok(bodyOf(w[1]).includes(formatMarker({ fingerprint: F, head: H })));
  assert.match(w[2], /^gh pr ready 470 .*--undo/);
  assert.equal(w.length, 3);
});

test("existing PR with a review", async () => {
  const skillPrs = [{ number: 470, author: BOT, body: formatMarker({ fingerprint: "c".repeat(64), head: RECORDED }), isDraft: false, reviews: [{ state: "COMMENTED" }] }];
  const { run, result } = await publish({ tableOpts: { remote: `${RECORDED}\trefs/heads/x`, skillPrs } });
  const w = writes(run);
  assert.equal(result.kind, "comment-skill-pr");
  assert.equal(w.length, 1);
  assert.match(w[0], /^gh pr comment 470 .*--body-file/);
  assert.ok(bodyOf(w[0]).includes(formatMarker({ fingerprint: F })));
});

test("recorded head differs", async () => {
  const skillPrs = [{ number: 470, author: BOT, body: formatMarker({ fingerprint: "c".repeat(64), head: RECORDED }), isDraft: false, reviews: [] }];
  const { run, result } = await publish({ tableOpts: { remote: `${"9".repeat(40)}\trefs/heads/x`, skillPrs } });
  const w = writes(run);
  assert.equal(result.kind, "comment-skill-pr");
  assert.equal(w.some((c) => c.startsWith("git push")), false);
  assert.match(w[0], /^gh pr comment 470 /);
});

test("a foreign PR on the skill branch name is neither edited nor trusted", async () => {
  // Its forged marker claims the current remote head, which would hide human work.
  const REMOTE = "9".repeat(40);
  const forged = { number: 999, author: { login: "mallory" }, body: formatMarker({ fingerprint: "c".repeat(64), head: REMOTE }), isDraft: false, reviews: [] };
  const { run, result } = await publish({ tableOpts: { remote: `${REMOTE}\trefs/heads/chore/emporix-api-sync-skill`, skillPrs: [forged] } });
  const w = writes(run);
  assert.equal(result.kind, "pr");
  assert.equal(w.some((c) => c.startsWith("gh pr edit 999") || c.startsWith("gh pr comment 999")), false);
  assert.match(w[1], /^gh pr create /);
});

test("a failing write still records the run on the sync PR", async () => {
  const t = table();
  t.unshift(["git push", () => { throw new Error("stale info"); }]);
  const run = fakeRunner(t);
  const result = await main({ env: env(), run, artifactDir: artifact(), tmpDir: mkdtempSync(join(tmpdir(), "publish-tmp-")) });
  assert.equal(result.kind, "failed");
  assert.match(result.reason, /publish failed: stale info/);
  const comment = writes(run).find((c) => c.startsWith("gh pr comment 461"));
  assert.ok(comment, "a failure comment on the sync PR");
  assert.ok(bodyOf(comment).includes(formatMarker({ fingerprint: F })));
});

test("changedPaths lists both sides of a rename, so a move into scope cannot hide a deletion", () => {
  const dir = mkdtempSync(join(tmpdir(), "publish-git-"));
  const git = (...a) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", ...a], { encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  mkdirSync(join(dir, ".github"));
  writeFileSync(join(dir, ".github", "x.yml"), "name: x\non: push\njobs: {}\n".repeat(20));
  git("add", "-A");
  git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  mkdirSync(join(dir, "packages", "sdk"), { recursive: true });
  git("mv", ".github/x.yml", "packages/sdk/x.yml");
  git("commit", "-qm", "move");
  const paths = changedPaths({ run: createRunner({ cwd: dir }), base, head: git("rev-parse", "HEAD") });
  assert.deepEqual(paths.sort(), [".github/x.yml", "packages/sdk/x.yml"]);
  assert.deepEqual(offendingPaths(paths), [".github/x.yml"]);
});

test("nothing", async () => {
  const { run, result } = await publish({ art: artifact({ outcome: NOTHING, report: "Nothing to add.", bundle: false }) });
  const w = writes(run);
  assert.equal(result.kind, "comment-bot");
  assert.equal(w.length, 1);
  assert.match(w[0], /^gh pr comment 461 .*--body-file/);
  const body = bodyOf(w[0]);
  assert.ok(body.startsWith("Nothing to add."));
  assert.ok(body.includes(formatMarker({ fingerprint: F })));
});

test("rehearsal comment is marked", async () => {
  const { run } = await publish({
    envOver: { MODE: "rehearsal" },
    art: artifact({ outcome: NOTHING, report: "Nothing to add.", bundle: false }),
  });
  assert.ok(bodyOf(writes(run)[0]).startsWith("[rehearsal] "));
});

test("failed skill job", async () => {
  const { run, result } = await publish({ envOver: { SKILL_RESULT: "failure" }, art: artifact({ outcome: null }) });
  const w = writes(run);
  assert.equal(result.kind, "failed");
  assert.notEqual(result.reason, "");
  assert.equal(w.length, 1);
  assert.match(w[0], /^gh pr comment 461 /);
  const body = bodyOf(w[0]);
  assert.ok(body.split("\n").includes(`Run: ${RUN_URL}`), "the run link on its own line");
  assert.ok(body.includes("skill_mode: live"));
  assert.ok(body.includes(formatMarker({ fingerprint: F })));
});

for (const [name, opts, cause] of [
  ["ship without commits", { art: artifact({ bundle: false }) }, /without commits/],
  ["nothing with commits", { art: artifact({ outcome: NOTHING }) }, /commits without/],
  ["not an ancestor", { tableOpts: { ancestor: false } }, /rewrites/],
  ["path outside scope", { tableOpts: { paths: ["packages/sdk/src/a.ts", ".github/workflows/x.yml"] } }, /outside scope: \.github\/workflows\/x\.yml/],
  ["report too long", { art: artifact({ report: "x".repeat(70000) }) }, /too long/],
  ["invalid outcome", { art: artifact({ outcome: { outcome: "merge" } }) }, /invalid outcome/],
]) {
  test(name, async () => {
    const { run, result } = await publish(opts);
    const w = writes(run);
    assert.equal(result.kind, "failed");
    assert.match(result.reason, cause);
    assert.equal(w.some((c) => c.startsWith("git push")), false);
    assert.equal(w.length, 1);
    assert.match(w[0], /^gh pr comment 461 /);
  });
}
