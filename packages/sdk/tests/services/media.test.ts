import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { MediaService } from "../../src/services/media";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";

const server = setupServer(
  http.post("https://api.emporix.io/oauth/token", () =>
    HttpResponse.json({ access_token: "svc-tok", token_type: "Bearer", expires_in: 3599 }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function svc() {
  const cfg = {
    tenant: "acme",
    host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "media" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new MediaService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

describe("MediaService.create", () => {
  it("BLOB: posts multipart/form-data with file + body JSON parts and a service token", async () => {
    let seenAuth: string | null = null;
    let seenCT: string | null = null;
    let receivedFile: File | null = null;
    let receivedBody: string | null = null;
    server.use(
      http.post("https://api.emporix.io/media/acme/assets", async ({ request }) => {
        seenAuth = request.headers.get("authorization");
        seenCT = request.headers.get("content-type");
        const fd = await request.formData();
        const f = fd.get("file");
        if (f instanceof File) receivedFile = f;
        const b = fd.get("body");
        if (typeof b === "string") receivedBody = b;
        return HttpResponse.json({ id: "asset-1" }, { status: 201 });
      }),
    );
    const result = await svc().create({
      kind: "blob",
      file: new File(["xyz"], "image.jpg", { type: "image/jpeg" }),
      body: {
        type: "BLOB",
        access: "PUBLIC",
        refIds: [{ type: "PRODUCT", id: "p1" }],
        details: { filename: "image.jpg", mimeType: "image/jpeg" },
      },
    });
    expect(result.id).toBe("asset-1");
    expect(seenAuth).toBe("Bearer svc-tok");
    expect(seenCT).toMatch(/^multipart\/form-data; boundary=/);
    expect((receivedFile as File | null)?.name).toBe("image.jpg");
    const parsed = JSON.parse(receivedBody!) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      type: "BLOB",
      access: "PUBLIC",
      refIds: [{ type: "PRODUCT", id: "p1" }],
      details: { filename: "image.jpg", mimeType: "image/jpeg" },
    });
  });

  it("LINK: posts application/json with the AssetCreateLink body", async () => {
    let seenCT: string | null = null;
    let seenBody: unknown = null;
    server.use(
      http.post("https://api.emporix.io/media/acme/assets", async ({ request }) => {
        seenCT = request.headers.get("content-type");
        seenBody = await request.json();
        return HttpResponse.json({ id: "asset-2" }, { status: 201 });
      }),
    );
    const result = await svc().create({
      kind: "link",
      body: {
        type: "LINK",
        access: "PUBLIC",
        url: "https://cdn.example/i.jpg",
        refIds: [{ type: "PRODUCT", id: "p1" }],
      },
    });
    expect(result.id).toBe("asset-2");
    expect(seenCT).toBe("application/json");
    expect(seenBody).toMatchObject({
      type: "LINK",
      access: "PUBLIC",
      url: "https://cdn.example/i.jpg",
    });
  });
});

describe("MediaService CRUD", () => {
  it("get/list/update/remove use the assets resource", async () => {
    server.use(
      http.get("https://api.emporix.io/media/acme/assets/asset-1", () =>
        HttpResponse.json({ id: "asset-1", type: "BLOB", access: "PUBLIC" }),
      ),
      http.get("https://api.emporix.io/media/acme/assets", () =>
        HttpResponse.json([{ id: "asset-1" }, { id: "asset-2" }]),
      ),
      http.put("https://api.emporix.io/media/acme/assets/asset-1", async ({ request }) => {
        const body = (await request.json()) as { access?: string };
        return HttpResponse.json({ id: "asset-1", access: body.access ?? "PUBLIC" });
      }),
      http.delete(
        "https://api.emporix.io/media/acme/assets/asset-1",
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    const s = svc();
    expect((await s.get("asset-1")).id).toBe("asset-1");
    expect(await s.list()).toHaveLength(2);
    expect(
      (await s.update("asset-1", { type: "BLOB", access: "PRIVATE" })).access,
    ).toBe("PRIVATE");
    await expect(s.remove("asset-1")).resolves.toBeUndefined();
  });
});
