import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { MixinSource, RawMixin } from "./types";
import { buildLock, diffLock, type Lock } from "./lock";
import { generateTypes } from "./generate";

export interface MixinsConfig {
  source: MixinSource;
  out: string;
  lockfile: string;
}

/** `check`: compare the live source against a lock; returns the drift list (empty = in sync). */
export async function runCheck(
  source: MixinSource,
  lock: Lock,
): Promise<{ drift: Array<{ key: string; from?: number; to?: number }> }> {
  const live = buildLock(await source.list());
  return { drift: diffLock(lock, live) };
}

/** `pull`: write snapshot.json next to the lockfile + (re)write the lockfile. */
export async function runPull(cfg: MixinsConfig): Promise<void> {
  const raw = await cfg.source.list();
  const snapshot = join(dirname(cfg.lockfile), "snapshot.json");
  await mkdir(dirname(cfg.lockfile), { recursive: true });
  await writeFile(snapshot, JSON.stringify(raw, null, 2));
  await writeFile(cfg.lockfile, JSON.stringify(buildLock(raw), null, 2));
}

/** `generate`: read snapshot.json → emit the typed files into `out`. */
export async function runGenerate(cfg: MixinsConfig): Promise<void> {
  const snapshot = join(dirname(cfg.lockfile), "snapshot.json");
  const raw = JSON.parse(await readFile(snapshot, "utf8")) as RawMixin[];
  const files = await generateTypes(raw);
  await mkdir(cfg.out, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(cfg.out, name), content);
  }
}
