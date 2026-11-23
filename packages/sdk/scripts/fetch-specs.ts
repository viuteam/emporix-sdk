/* eslint-disable no-console */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hashSpec,
  readSpecVersion,
  diffManifest,
  type SyncManifest,
  type SpecManifestEntry,
} from "./sync-manifest";
import { applyPatches } from "./spec-patches";
import { SPECS } from "./specs";

async function readManifest(path: string): Promise<SyncManifest | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as SyncManifest;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "specs");
  await mkdir(dir, { recursive: true });
  const manifestPath = join(dir, ".sync-manifest.json");
  const prev = await readManifest(manifestPath);
  const now = new Date().toISOString();
  const services: Record<string, SpecManifestEntry> = {};
  for (const [name, url] of Object.entries(SPECS)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${name} spec: ${res.status} ${url}`);
    const raw = await res.text();
    // Repair known upstream defects (dangling $refs, mis-placed schemas) before
    // the spec is written and hashed, so `generate` can't crash on them. See
    // scripts/spec-patches.ts.
    const { yaml, applied, stale } = applyPatches(name, raw);
    for (const reason of applied) console.log(`  patched ${name}: ${reason}`);
    for (const p of stale) console.warn(`  ⚠ stale patch for ${name} — no change, remove it: ${p.reason}`);
    await writeFile(join(dir, `${name}.yml`), yaml, "utf8");
    services[name] = { url, specVersion: readSpecVersion(yaml), fetchedAt: now, sha256: hashSpec(yaml) };
    console.log(`fetched ${name} (${raw.length} bytes)`);
  }
  const next: SyncManifest = { generatedAt: now, services };
  const changed = diffManifest(prev, next);
  await writeFile(manifestPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  if (!prev) {
    console.log(`wrote initial sync manifest (${Object.keys(services).length} services)`);
  } else if (changed.length) {
    console.log(`changed since last vendored: ${changed.join(", ")}`);
  } else {
    console.log("no spec changes since last vendored");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
