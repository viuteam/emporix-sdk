// Guard rails for the security-relevant shape of the `skill` job. Text checks on
// purpose: the repo has no YAML parser at the root, and these assert a handful
// of lines a refactor must not lose.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const workflow = readFileSync(fileURLToPath(new URL("../../workflows/api-sync.yml", import.meta.url)), "utf8");
const skillJob = workflow.slice(workflow.indexOf("\n  skill:\n"), workflow.indexOf("\n  publish:\n"));
const step = (name) => {
  const start = skillJob.indexOf(`- name: ${name}`);
  assert.notEqual(start, -1, `step ${name} missing`);
  const next = skillJob.indexOf("\n      - ", start + 1);
  return skillJob.slice(start, next === -1 ? undefined : next);
};

test("the skill job saves no pnpm cache after Claude ran", () =>
  assert.equal(/cache:\s*pnpm/.test(skillJob), false));

test("the Claude step has its own timeout inside the job's", () =>
  assert.match(step("Run the skill"), /\n\s+timeout-minutes: 45\n/));

test("Claude's file tools are scoped to the paths publish accepts", () => {
  const allowed = step("Run the skill").match(/--allowedTools "([^"]+)"/)[1].split(",");
  assert.equal(allowed.includes("Edit"), false);
  assert.equal(allowed.includes("Write"), false);
  for (const tool of ["Edit", "Write"]) {
    for (const scope of ["packages/sdk/**", "docs/**", ".changeset/**"]) assert.ok(allowed.includes(`${tool}(${scope})`), `${tool}(${scope})`);
  }
});

test("post-Claude git runs on the restored config through the protected script", () => {
  const pkg = step("Package and check the result");
  const restore = pkg.indexOf("sudo cat /opt/api-sync-skill/git-config > .git/config");
  const script = pkg.indexOf("node /opt/api-sync-skill/package.mjs");
  assert.ok(restore > -1 && script > restore, "restore the config, then run the protected script");
  assert.equal(/\bgit (diff|log)\b/.test(pkg), false, "no porcelain git after Claude");
});

test("the sandbox step unloads Ubuntu's bwrap-userns-restrict AppArmor profile", () => {
  // Ubuntu 26.04 confines bwrap's children to a profile without capabilities,
  // so the sandbox's nested user namespace fails (anthropics/claude-code#105194).
  const deps = step("Install sandbox dependencies");
  assert.match(deps, /apparmor_parser -R \/etc\/apparmor\.d\/bwrap-userns-restrict/);
  assert.match(deps, /kernel\.apparmor_restrict_unprivileged_userns=0/);
});

test("the sandbox's placeholder files are excluded from git before Claude runs", () => {
  // During a sandboxed command, bubblewrap's mount points (.bashrc, .gitconfig,
  // .mcp.json, …) sit in the repo root as untracked files; seen in dry run 3.
  const checkout = step("Check out the sync PR with the workflow's skill");
  for (const name of ["/.bashrc", "/.gitconfig", "/.mcp.json", "/.vscode/", "/scripts/"]) {
    assert.ok(checkout.includes(name), name);
  }
  assert.match(checkout, />> \.git\/info\/exclude/);
});

test("the turn cap leaves room for subagent turns", () => {
  // The action fails the step when the result's num_turns exceeds --max-turns,
  // and that count includes subagent turns: the first rehearsal finished its
  // work in 113 turns under a cap of 80 and was reported as a failure.
  const turns = Number(step("Run the skill").match(/--max-turns (\d+)/)[1]);
  assert.ok(turns >= 200, `--max-turns ${turns}`);
});

test("the upload is gated on the package step", () =>
  assert.match(skillJob, /if: always\(\) && steps\.gate\.outputs\.run == 'true' && steps\.package\.outcome == 'success'/));

test("the protected copies are made before Claude runs", () => {
  const order = ["/opt/api-sync-skill/package.mjs", "/opt/api-sync-skill/git-config", "- name: Run the skill"].map((s) =>
    skillJob.indexOf(s),
  );
  assert.ok(order.every((i) => i > -1) && order[0] < order[2] && order[1] < order[2], String(order));
});
