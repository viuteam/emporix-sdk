import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveMode, fingerprint, changedServices, decide, main } from "./gate.mjs";
import { formatMarker } from "./shared.mjs";
import { fakeRunner } from "./test-helpers.mjs";

const F = "a".repeat(64);

test("resolveMode", () => {
  const c = (eventName, variable, input) => resolveMode({ eventName, variable, input });
  assert.equal(c("schedule", undefined, undefined), "off");
  assert.equal(c("schedule", "live"), "live");
  assert.equal(c("schedule", "rehearsal"), "rehearsal");
  assert.equal(c("schedule", "dry"), "off"); // dry is dispatch-only
  assert.equal(c("schedule", "LIVE"), "off"); // typos fail safe
  assert.equal(c("workflow_dispatch", "off", "live"), "live");
  assert.equal(c("workflow_dispatch", "live", "off"), "off");
  assert.equal(c("workflow_dispatch", undefined, ""), "off");
  assert.equal(c("push", "live"), "off");
});

const tree = (yml, manifest) =>
  `100644 blob ${yml}\tpackages/sdk/specs/ai-service.yml\n` +
  `100644 blob ${manifest}\tpackages/sdk/specs/.sync-manifest.json\n`;

test("fingerprint ignores the manifest", () =>
  assert.equal(
    fingerprint(tree("1".repeat(40), "2".repeat(40))),
    fingerprint(tree("1".repeat(40), "3".repeat(40))),
  ));

test("fingerprint changes with a spec blob", () =>
  assert.notEqual(
    fingerprint(tree("1".repeat(40), "2".repeat(40))),
    fingerprint(tree("4".repeat(40), "2".repeat(40))),
  ));

test("fingerprint is order-independent and fails without specs", () => {
  const a = `100644 blob ${"1".repeat(40)}\tpackages/sdk/specs/a.yml`;
  const b = `100644 blob ${"2".repeat(40)}\tpackages/sdk/specs/b.yml`;
  assert.equal(fingerprint(`${a}\n${b}\n`), fingerprint(`${b}\n${a}\n`));
  assert.match(fingerprint(`${a}\n`), /^[0-9a-f]{64}$/);
  assert.throws(() => fingerprint(""));
});

test("changedServices", () =>
  assert.deepEqual(
    changedServices([
      "packages/sdk/specs/media.yml",
      "packages/sdk/specs/.sync-manifest.json",
      "packages/sdk/src/generated/x.ts",
      "packages/sdk/specs/ai-service.yml",
    ]),
    ["ai-service", "media"],
  ));

test("decide", () => {
  const pr = { number: 461 };
  assert.equal(decide({ mode: "off", eventName: "schedule", botPr: pr, fingerprint: F, seen: [] }).run, false);
  assert.deepEqual(
    decide({ mode: "dry", eventName: "workflow_dispatch", botPr: null, fingerprint: F, seen: [] }),
    { run: true, base: "main", reason: "no open sync PR; dry run on main" },
  );
  assert.equal(decide({ mode: "live", eventName: "workflow_dispatch", botPr: null, fingerprint: F, seen: [] }).run, false);
  assert.equal(decide({ mode: "live", eventName: "schedule", botPr: pr, fingerprint: F, seen: [F] }).run, false);
  assert.equal(decide({ mode: "live", eventName: "workflow_dispatch", botPr: pr, fingerprint: F, seen: [F] }).run, true);
  assert.equal(decide({ mode: "live", eventName: "schedule", botPr: pr, fingerprint: F, seen: [] }).base, "pr");
});

// --- main ---------------------------------------------------------------------

const PR_HEAD = "c".repeat(40);
const MAIN_HEAD = "d".repeat(40);
const SPEC_TREE = `100644 blob ${"1".repeat(40)}\tpackages/sdk/specs/ai-service.yml\n`;
const FP = fingerprint(SPEC_TREE);

const botPr = (login = "app/viu-release-bot") => ({
  number: 461,
  headRefOid: PR_HEAD,
  title: "chore(sdk): sync generated types with upstream emporix api specs",
  body: "Automated daily sync",
  url: "https://github.com/R/pull/461",
  author: { login },
  files: [{ path: "packages/sdk/specs/ai-service.yml" }, { path: "packages/sdk/specs/.sync-manifest.json" }],
});

/** Table order matters: the skill-branch key must precede its prefix, the bot-branch key. */
function table({ prs = [botPr()], skillPrs = [], botComments = [] } = {}) {
  return [
    ["gh pr list --repo R --head chore/emporix-api-sync-skill", JSON.stringify(skillPrs)],
    ["gh pr list --repo R --head chore/emporix-api-sync", JSON.stringify(prs)],
    ["git rev-parse refs/remotes/origin/main", MAIN_HEAD],
    ["git ls-tree -r", SPEC_TREE],
    ["gh pr view 461 --repo R --json comments", JSON.stringify({ comments: botComments })],
  ];
}

const env = (over) => ({ GITHUB_REPOSITORY: "R", GITHUB_EVENT_NAME: "schedule", API_SYNC_SKILL: "live", ...over });
const outDir = () => join(mkdtempSync(join(tmpdir(), "gate-")), "out"); // not created: main must create it

test("scheduled live run on new content", async () => {
  const dir = outDir();
  const out = await main({ env: env(), run: fakeRunner(table()), outDir: dir });
  assert.deepEqual(out, { run: "true", mode: "live", base_sha: PR_HEAD, bot_pr: "461", fingerprint: FP });
  const ctx = JSON.parse(readFileSync(join(dir, "context.json"), "utf8"));
  assert.deepEqual(ctx.changedServices, ["ai-service"]);
  assert.equal(ctx.baseSha, PR_HEAD);
  assert.equal(ctx.botPr.number, 461);
});

test("scheduled run already handled", async () => {
  const dir = outDir();
  const botComments = [{ author: { login: "app/viu-release-bot" }, body: formatMarker({ fingerprint: FP }) }];
  const out = await main({ env: env(), run: fakeRunner(table({ botComments })), outDir: dir });
  assert.equal(out.run, "false");
  assert.equal(existsSync(join(dir, "context.json")), false);
});

test("scheduled run already handled through the skill PR body", async () => {
  const skillPrs = [{ body: `report\n${formatMarker({ fingerprint: FP, head: PR_HEAD })}`, comments: [] }];
  const out = await main({ env: env(), run: fakeRunner(table({ skillPrs })), outDir: outDir() });
  assert.equal(out.run, "false");
});

test("human marker does not suppress", async () => {
  const botComments = [{ author: { login: "dominic" }, body: formatMarker({ fingerprint: FP }) }];
  const skillPrs = [{ body: "", comments: [{ author: { login: "dominic" }, body: formatMarker({ fingerprint: FP }) }] }];
  const out = await main({ env: env(), run: fakeRunner(table({ botComments, skillPrs })), outDir: outDir() });
  assert.equal(out.run, "true");
});

test("dry dispatch without a sync PR", async () => {
  const run = fakeRunner(table({ prs: [] }));
  const out = await main({
    env: env({ GITHUB_EVENT_NAME: "workflow_dispatch", SKILL_MODE: "dry" }),
    run,
    outDir: outDir(),
  });
  assert.equal(out.run, "true");
  assert.equal(out.base_sha, MAIN_HEAD);
  assert.equal(out.bot_pr, "");
});

test("dispatch never reads markers", async () => {
  const run = fakeRunner(table());
  await main({ env: env({ GITHUB_EVENT_NAME: "workflow_dispatch", SKILL_MODE: "live" }), run, outDir: outDir() });
  assert.equal(run.calls.some((c) => c.startsWith("gh pr list --repo R --head chore/emporix-api-sync-skill")), false);
  assert.equal(run.calls.some((c) => c.startsWith("gh pr view")), false);
});

test("bot PR by another author is ignored", async () => {
  const out = await main({
    env: env({ GITHUB_EVENT_NAME: "workflow_dispatch", SKILL_MODE: "live" }),
    run: fakeRunner(table({ prs: [botPr("dominic")] })),
    outDir: outDir(),
  });
  assert.equal(out.run, "false");
  assert.equal(out.bot_pr, "");
});

test("mode off reads nothing", async () => {
  const run = fakeRunner(table());
  const out = await main({ env: env({ API_SYNC_SKILL: undefined }), run, outDir: outDir() });
  assert.equal(out.run, "false");
  assert.equal(out.mode, "off");
  assert.deepEqual(run.calls, []);
});
