/* eslint-disable no-console */
import { createClient } from "@hey-api/openapi-ts";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const specsDir = join(root, "specs");
const outRoot = join(root, "src", "generated");
const BANNER = "// AUTO-GENERATED — do not edit\n";

async function prependBanner(dir: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      await prependBanner(p);
    } else if (entry.name.endsWith(".ts")) {
      const src = await readFile(p, "utf8");
      if (!src.startsWith(BANNER)) await writeFile(p, BANNER + src, "utf8");
    }
  }
}

async function main(): Promise<void> {
  const specs = (await readdir(specsDir)).filter((f) => f.endsWith(".yml"));
  for (const file of specs) {
    const name = file.replace(/\.yml$/, "");
    const output = join(outRoot, name);
    await createClient({
      input: join(specsDir, file),
      output,
      plugins: ["@hey-api/typescript"], // types only — no runtime client
    });
    await prependBanner(output);
    console.log(`generated ${name}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
