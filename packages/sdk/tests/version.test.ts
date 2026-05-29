import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SDK_VERSION } from "../src/version";

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
) as { version: string };

describe("SDK_VERSION", () => {
  it("reflects the real package.json version, not the 0.0.0 placeholder", () => {
    expect(SDK_VERSION).toBe(pkg.version);
    expect(SDK_VERSION).not.toBe("0.0.0");
  });
});
