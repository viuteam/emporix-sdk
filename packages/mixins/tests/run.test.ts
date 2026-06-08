import { describe, it, expect } from "vitest";
import { runCheck } from "../src/codegen/run";
import type { MixinSource } from "../src/codegen/types";
import { buildLock } from "../src/codegen/lock";

const source: MixinSource = {
  list: async () => [
    { key: "x", entity: "CART", version: 7, url: "https://cdn/x.v7.json", schema: { type: "object" } },
  ],
};

describe("runCheck", () => {
  it("reports drift when the live version differs from the lock", async () => {
    const lock = buildLock([
      { key: "x", entity: "CART", version: 6, url: "https://cdn/x.v6.json", schema: { type: "object" } },
    ]);
    const res = await runCheck(source, lock);
    expect(res.drift).toEqual([{ key: "x", from: 6, to: 7 }]);
  });

  it("reports no drift when in sync", async () => {
    const lock = buildLock(await source.list());
    const res = await runCheck(source, lock);
    expect(res.drift).toEqual([]);
  });
});
