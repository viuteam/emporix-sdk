/**
 * Helpers shared by the gate and the publish step of the API sync skill run
 * (`.github/workflows/api-sync.yml`). Node built-ins only: the publish job runs
 * these scripts with plain `node`, without `pnpm install`.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

export const BOT_BRANCH = "chore/emporix-api-sync";
export const SKILL_BRANCH = "chore/emporix-api-sync-skill";
/** GitHub's limit for a PR body or comment. */
export const MAX_BODY = 65536;

const MARKER = /<!-- emporix-api-sync-skill fingerprint=([0-9a-f]{64}) head=([0-9a-f]{40}|-) -->/g;

/** The marker that records which spec content a run handled, and which head it pushed. */
export function formatMarker({ fingerprint, head }) {
  return `<!-- emporix-api-sync-skill fingerprint=${fingerprint} head=${head ?? "-"} -->`;
}

export function parseMarkers(text) {
  return [...(text ?? "").matchAll(MARKER)].map(([, fingerprint, head]) => ({
    fingerprint,
    head: head === "-" ? null : head,
  }));
}

// `gh` reports the app as `app/viu-release-bot` on PRs; REST uses the `[bot]` suffix.
const RELEASE_BOT_LOGINS = new Set(["app/viu-release-bot", "viu-release-bot", "viu-release-bot[bot]"]);

export function isReleaseBot(login) {
  return RELEASE_BOT_LOGINS.has(login);
}

export function writeOutputs(outputs, file = process.env.GITHUB_OUTPUT) {
  const lines = Object.entries(outputs).map(([key, value]) => {
    if (/[\r\n]/.test(value)) throw new Error(`output ${key} must be a single line`);
    return `${key}=${value}\n`;
  });
  if (file) appendFileSync(file, lines.join(""));
}

export function appendSummary(markdown, file = process.env.GITHUB_STEP_SUMMARY) {
  if (file) appendFileSync(file, `${markdown}\n`);
}

/** Runs a command without a shell and returns its trimmed stdout; throws on a non-zero exit. */
export function createRunner() {
  return (cmd, args) =>
    execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 }).trimEnd();
}
