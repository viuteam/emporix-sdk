#!/usr/bin/env node
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { createJiti } from "jiti";
import { runCheck, runPull, runGenerate, type MixinsConfig } from "./codegen/run";
import type { Lock } from "./codegen/lock";

async function loadConfig(): Promise<MixinsConfig> {
  const path = resolve(process.cwd(), "emporix-mixins.config.ts");
  const jiti = createJiti(import.meta.url);
  const mod = (await jiti.import(path)) as { default: MixinsConfig };
  return mod.default;
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  const cfg = await loadConfig();
  if (cmd === "pull") {
    await runPull(cfg);
    console.log("[emporix-mixins] pull: snapshot + lock written");
  } else if (cmd === "generate") {
    await runGenerate(cfg);
    console.log(`[emporix-mixins] generate: types written to ${cfg.out}`);
  } else if (cmd === "check") {
    const lock = JSON.parse(await readFile(cfg.lockfile, "utf8")) as Lock;
    const { drift } = await runCheck(cfg.source, lock);
    if (drift.length === 0) {
      console.log("[emporix-mixins] check: in sync");
    } else {
      console.error("[emporix-mixins] check: DRIFT", JSON.stringify(drift));
      process.exitCode = 1;
    }
  } else {
    console.error("usage: emporix-mixins <pull|generate|check>");
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
