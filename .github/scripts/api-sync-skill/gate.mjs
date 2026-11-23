/**
 * Gate of the API sync skill run: decides whether Claude runs, on which base,
 * and writes the context file the skill reads instead of calling `gh` itself.
 *
 * Outputs (GITHUB_OUTPUT): run, mode, base_sha, bot_pr, fingerprint.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BOT_BRANCH, SKILL_BRANCH, createRunner, isReleaseBot, parseMarkers, writeOutputs } from "./shared.mjs";

const SCHEDULE_MODES = new Set(["rehearsal", "live"]);
const DISPATCH_MODES = new Set(["dry", "rehearsal", "live"]);
const SPEC = /^packages\/sdk\/specs\/([^/]+)\.yml$/;

/** Schedules read the repository variable, a dispatch its input; anything unknown is `off`. */
export function resolveMode({ eventName, variable, input }) {
  if (eventName === "schedule") return SCHEDULE_MODES.has(variable) ? variable : "off";
  if (eventName === "workflow_dispatch") return DISPATCH_MODES.has(input) ? input : "off";
  return "off";
}

/** sha256 over the blob ids of the vendored `*.yml` specs; the manifest's timestamps change daily. */
export function fingerprint(lsTree) {
  const specs = lsTree
    .split("\n")
    .map((line) => line.match(/^\d+ blob ([0-9a-f]+)\t(.+\.yml)$/))
    .filter(Boolean)
    .map(([, oid, path]) => ({ oid, path }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (specs.length === 0) throw new Error("no vendored specs found");
  return createHash("sha256")
    .update(specs.map(({ oid, path }) => `${oid} ${path}\n`).join(""))
    .digest("hex");
}

export function changedServices(files) {
  return files
    .map((f) => f.match(SPEC)?.[1])
    .filter(Boolean)
    .sort();
}

export function decide({ mode, eventName, botPr, fingerprint, seen }) {
  if (mode === "off") return { run: false, base: null, reason: "mode off" };
  if (!botPr) {
    return mode === "dry"
      ? { run: true, base: "main", reason: "no open sync PR; dry run on main" }
      : { run: false, base: null, reason: "no open sync PR" };
  }
  // A human dispatch is a deliberate rerun, so only schedules skip content already handled.
  if (eventName === "schedule" && seen.includes(fingerprint)) {
    return { run: false, base: null, reason: `spec content ${fingerprint} already handled` };
  }
  return { run: true, base: "pr", reason: `sync PR #${botPr.number}` };
}

/** Fingerprints recorded by the release bot; a marker anyone else writes is ignored. */
function seenFingerprints({ run, repo, botPr }) {
  const texts = [];
  const [skillPr] = JSON.parse(
    run("gh", ["pr", "list", "--repo", repo, "--head", SKILL_BRANCH, "--state", "all", "--limit", "1", "--json", "body,comments"]),
  );
  if (skillPr) {
    texts.push(skillPr.body);
    texts.push(...skillPr.comments.filter((c) => isReleaseBot(c.author?.login)).map((c) => c.body));
  }
  const { comments } = JSON.parse(run("gh", ["pr", "view", String(botPr.number), "--repo", repo, "--json", "comments"]));
  texts.push(...comments.filter((c) => isReleaseBot(c.author?.login)).map((c) => c.body));
  return texts.flatMap(parseMarkers).map((m) => m.fingerprint);
}

export async function main({ env, run, outDir }) {
  const repo = env.GITHUB_REPOSITORY;
  const eventName = env.GITHUB_EVENT_NAME;
  const mode = resolveMode({ eventName, variable: env.API_SYNC_SKILL, input: env.SKILL_MODE });
  const skip = { run: "false", mode, base_sha: "", bot_pr: "", fingerprint: "" };
  if (mode === "off") return skip;

  const prs = JSON.parse(
    run("gh", [
      "pr", "list", "--repo", repo, "--head", BOT_BRANCH, "--state", "open",
      "--json", "number,headRefOid,title,body,url,author,files",
    ]),
  );
  const botPr = prs.find((pr) => isReleaseBot(pr.author?.login)) ?? null;
  const baseSha = botPr ? botPr.headRefOid : run("git", ["rev-parse", "refs/remotes/origin/main"]);
  const fp = fingerprint(run("git", ["ls-tree", "-r", baseSha, "--", "packages/sdk/specs"]));
  const seen = eventName === "schedule" && botPr ? seenFingerprints({ run, repo, botPr }) : [];

  const verdict = decide({ mode, eventName, botPr, fingerprint: fp, seen });
  const outputs = { run: String(verdict.run), mode, base_sha: "", bot_pr: botPr ? String(botPr.number) : "", fingerprint: fp };
  if (!verdict.run) return outputs;

  mkdirSync(outDir, { recursive: true });
  const context = {
    mode,
    baseSha,
    botPr: botPr && { number: botPr.number, title: botPr.title, body: botPr.body, url: botPr.url },
    changedServices: changedServices((botPr?.files ?? []).map((f) => f.path)),
    fingerprint: fp,
  };
  writeFileSync(join(outDir, "context.json"), `${JSON.stringify(context, null, 2)}\n`);
  return { ...outputs, base_sha: baseSha };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outputs = await main({ env: process.env, run: createRunner(), outDir: process.env.OUT_DIR });
  console.log(`gate: ${JSON.stringify(outputs)}`);
  writeOutputs(outputs);
}
