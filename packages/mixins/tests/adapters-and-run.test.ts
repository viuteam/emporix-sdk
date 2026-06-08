import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { mkdtemp, writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localFiles } from "../src/codegen/adapters/local-files";
import { cdnManifest } from "../src/codegen/adapters/cdn-manifest";
import { runPull, runGenerate } from "../src/codegen/run";
import type { MixinSource } from "../src/codegen/types";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("localFiles adapter", () => {
  it("reads schemas from local files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mixins-lf-"));
    const schemaPath = join(dir, "x.json");
    await writeFile(schemaPath, JSON.stringify({ type: "object", properties: { a: { type: "string" } } }));
    const raw = await localFiles({
      manifest: [{ key: "x", entity: "CART", version: 2, url: "https://cdn/x.v2.json", schemaPath }],
    }).list();
    expect(raw).toEqual([
      { key: "x", entity: "CART", version: 2, url: "https://cdn/x.v2.json",
        schema: { type: "object", properties: { a: { type: "string" } } } },
    ]);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("cdnManifest adapter", () => {
  it("fetches schemas from pinned URLs", async () => {
    server.use(
      http.get("https://cdn/y.v1.json", () => HttpResponse.json({ type: "object" })),
    );
    const raw = await cdnManifest({
      entries: [{ key: "y", entity: "ORDER", version: 1, url: "https://cdn/y.v1.json" }],
    }).list();
    expect(raw[0]).toMatchObject({ key: "y", version: 1, schema: { type: "object" } });
  });

  it("throws when a URL is not ok", async () => {
    server.use(http.get("https://cdn/z.v1.json", () => new HttpResponse(null, { status: 500 })));
    await expect(
      cdnManifest({ entries: [{ key: "z", entity: "ORDER", version: 1, url: "https://cdn/z.v1.json" }] }).list(),
    ).rejects.toThrow();
  });
});

describe("runPull + runGenerate", () => {
  it("pull writes snapshot+lock; generate emits types into out", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mixins-run-"));
    const out = join(dir, "generated");
    const lockfile = join(dir, "mixins.lock.json");
    await mkdir(dir, { recursive: true });
    const source: MixinSource = {
      list: async () => [
        { key: "deliveryOptions", entity: "CUSTOMER", version: 6, url: "https://cdn/d.v6.json",
          schema: { type: "object", additionalProperties: false, properties: { packaging: { type: "string" } } } },
      ],
    };

    await runPull({ source, out, lockfile });
    const lock = JSON.parse(await readFile(lockfile, "utf8"));
    expect(lock.deliveryOptions.version).toBe(6);
    const snapshot = JSON.parse(await readFile(join(dir, "snapshot.json"), "utf8"));
    expect(snapshot).toHaveLength(1);

    await runGenerate({ source, out, lockfile });
    const registry = await readFile(join(out, "registry.ts"), "utf8");
    expect(registry).toMatch(/export const mixins/);
    const ts = await readFile(join(out, "delivery-options.ts"), "utf8");
    expect(ts).toMatch(/DeliveryOptionsMixinV6/);

    await rm(dir, { recursive: true, force: true });
  });
});
