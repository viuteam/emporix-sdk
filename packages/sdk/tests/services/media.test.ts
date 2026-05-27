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
    expect((await s.list()).items).toHaveLength(2);
    expect(
      (
        await s.update("asset-1", {
          kind: "json",
          body: { type: "BLOB", access: "PRIVATE" },
        })
      ).access,
    ).toBe("PRIVATE");
    await expect(s.remove("asset-1")).resolves.toBeUndefined();
  });

  it("list() wraps results in a PaginatedItems envelope with hasNextPage heuristic", async () => {
    server.use(
      http.get("https://api.emporix.io/media/acme/assets", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("pageNumber")).toBe("1");
        expect(url.searchParams.get("pageSize")).toBe("2");
        return HttpResponse.json([{ id: "a" }, { id: "b" }]);
      }),
    );
    const page = await svc().list({ pageSize: 2 });
    expect(page.items.map((a) => a.id)).toEqual(["a", "b"]);
    expect(page.pageNumber).toBe(1);
    expect(page.pageSize).toBe(2);
    expect(page.hasNextPage).toBe(true); // items.length === pageSize → assume more
  });

  it("list() hasNextPage=false when the page is not full", async () => {
    server.use(
      http.get("https://api.emporix.io/media/acme/assets", () =>
        HttpResponse.json([{ id: "a" }]),
      ),
    );
    const page = await svc().list({ pageSize: 10 });
    expect(page.items).toHaveLength(1);
    expect(page.hasNextPage).toBe(false);
  });

  it("update() multipart: BLOB file-replacement sends multipart with file + body parts", async () => {
    let receivedFile: File | null = null;
    let receivedBody: string | null = null;
    let seenCT: string | null = null;
    server.use(
      http.put("https://api.emporix.io/media/acme/assets/asset-1", async ({ request }) => {
        seenCT = request.headers.get("content-type");
        const fd = await request.formData();
        const f = fd.get("file");
        if (f instanceof File) receivedFile = f;
        const b = fd.get("body");
        if (typeof b === "string") receivedBody = b;
        return HttpResponse.json({
          id: "asset-1",
          type: "BLOB",
          access: "PUBLIC",
          details: { filename: "new.jpg", mimeType: "image/jpeg" },
        });
      }),
    );
    const result = await svc().update("asset-1", {
      kind: "blob",
      file: new File(["new bytes"], "new.jpg", { type: "image/jpeg" }),
      body: {
        type: "BLOB",
        access: "PUBLIC",
        details: { filename: "new.jpg", mimeType: "image/jpeg" },
        metadata: { version: 3 },
      },
    });
    expect(seenCT).toMatch(/^multipart\/form-data; boundary=/);
    expect((receivedFile as File | null)?.name).toBe("new.jpg");
    const parsed = JSON.parse(receivedBody!) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      type: "BLOB",
      access: "PUBLIC",
      metadata: { version: 3 },
    });
    expect(result.id).toBe("asset-1");
  });

  it("replaceFile() builds an AssetUpdateBlob with details + version", async () => {
    let parsedBody: Record<string, unknown> | null = null;
    server.use(
      http.put("https://api.emporix.io/media/acme/assets/asset-1", async ({ request }) => {
        const fd = await request.formData();
        const b = fd.get("body");
        if (typeof b === "string") parsedBody = JSON.parse(b) as Record<string, unknown>;
        return HttpResponse.json({ id: "asset-1", type: "BLOB", access: "PRIVATE" });
      }),
    );
    await svc().replaceFile("asset-1", {
      file: new File(["x"], "doc.pdf", { type: "application/pdf" }),
      access: "PRIVATE",
      filename: "doc.pdf",
      mimeType: "application/pdf",
      version: 7,
    });
    expect(parsedBody).toMatchObject({
      type: "BLOB",
      access: "PRIVATE",
      details: { filename: "doc.pdf", mimeType: "application/pdf" },
      metadata: { version: 7 },
    });
  });

  it("replaceFile() omits details + metadata when not supplied", async () => {
    let parsedBody: Record<string, unknown> | null = null;
    server.use(
      http.put("https://api.emporix.io/media/acme/assets/asset-1", async ({ request }) => {
        const fd = await request.formData();
        const b = fd.get("body");
        if (typeof b === "string") parsedBody = JSON.parse(b) as Record<string, unknown>;
        return HttpResponse.json({ id: "asset-1", type: "BLOB", access: "PUBLIC" });
      }),
    );
    await svc().replaceFile("asset-1", {
      file: new File(["x"], "f", { type: "image/png" }),
      access: "PUBLIC",
    });
    expect(parsedBody).toEqual({ type: "BLOB", access: "PUBLIC" });
  });
});

describe("MediaService convenience", () => {
  it("uploadFile builds an AssetCreateBlob with refIds + details from the input", async () => {
    let parsedBody: Record<string, unknown> | null = null;
    server.use(
      http.post("https://api.emporix.io/media/acme/assets", async ({ request }) => {
        const fd = await request.formData();
        const b = fd.get("body");
        if (typeof b === "string") parsedBody = JSON.parse(b) as Record<string, unknown>;
        return HttpResponse.json({ id: "a" }, { status: 201 });
      }),
    );
    await svc().uploadFile({
      file: new File(["x"], "p.png", { type: "image/png" }),
      productId: "p1",
      filename: "p.png",
      mimeType: "image/png",
    });
    expect(parsedBody).toMatchObject({
      type: "BLOB",
      access: "PUBLIC",
      refIds: [{ type: "PRODUCT", id: "p1" }],
      details: { filename: "p.png", mimeType: "image/png" },
    });
  });

  it("link builds an AssetCreateLink body", async () => {
    let body: unknown = null;
    server.use(
      http.post("https://api.emporix.io/media/acme/assets", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "a" }, { status: 201 });
      }),
    );
    await svc().link({ url: "https://cdn/i.jpg", productId: "p1" });
    expect(body).toMatchObject({
      type: "LINK",
      access: "PUBLIC",
      url: "https://cdn/i.jpg",
      refIds: [{ type: "PRODUCT", id: "p1" }],
    });
  });

  it("attachToProduct is idempotent (no duplicate PRODUCT refId)", async () => {
    let putBody: { refIds?: Array<{ type?: string; id?: string }> } | null = null;
    server.use(
      http.get("https://api.emporix.io/media/acme/assets/a", () =>
        HttpResponse.json({ id: "a", refIds: [{ type: "PRODUCT", id: "p1" }] }),
      ),
      http.put("https://api.emporix.io/media/acme/assets/a", async ({ request }) => {
        putBody = (await request.json()) as typeof putBody;
        return HttpResponse.json({ id: "a", refIds: putBody?.refIds ?? [] });
      }),
    );
    await svc().attachToProduct("a", "p1"); // already attached → no PUT
    expect(putBody).toBeNull();
    await svc().attachToProduct("a", "p2"); // new product → PUT with both
    expect(
      (putBody as { refIds?: Array<{ type?: string; id?: string }> } | null)?.refIds,
    ).toEqual([
      { type: "PRODUCT", id: "p1" },
      { type: "PRODUCT", id: "p2" },
    ]);
  });

  it("detachFromProduct removes the matching PRODUCT refId", async () => {
    let putBody: { refIds?: Array<{ type?: string; id?: string }> } | null = null;
    server.use(
      http.get("https://api.emporix.io/media/acme/assets/a", () =>
        HttpResponse.json({
          id: "a",
          refIds: [
            { type: "PRODUCT", id: "p1" },
            { type: "PRODUCT", id: "p2" },
            { type: "CATEGORY", id: "c1" },
          ],
        }),
      ),
      http.put("https://api.emporix.io/media/acme/assets/a", async ({ request }) => {
        putBody = (await request.json()) as typeof putBody;
        return HttpResponse.json({ id: "a", refIds: putBody?.refIds ?? [] });
      }),
    );
    await svc().detachFromProduct("a", "p1");
    expect(
      (putBody as { refIds?: Array<{ type?: string; id?: string }> } | null)?.refIds,
    ).toEqual([
      { type: "PRODUCT", id: "p2" },
      { type: "CATEGORY", id: "c1" },
    ]);
  });

  it("listForProduct passes the refIds.id filter as a query param", async () => {
    let query: URLSearchParams | null = null;
    server.use(
      http.get("https://api.emporix.io/media/acme/assets", ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json([{ id: "a", refIds: [{ type: "PRODUCT", id: "p1" }] }]);
      }),
    );
    const page = await svc().listForProduct("p1");
    expect(query !== null && (query as URLSearchParams).get("refIds.id")).toBe("p1");
    expect(page.items).toHaveLength(1);
    expect(page.pageNumber).toBe(1);
    expect(page.pageSize).toBe(60);
    expect(page.hasNextPage).toBe(false);
  });
});

describe("MediaService.download", () => {
  it("PUBLIC asset: returns { kind: 'redirect', url } from the Location header", async () => {
    server.use(
      http.get("https://api.emporix.io/media/acme/assets/pub-1/download", () =>
        new HttpResponse(null, {
          status: 301,
          headers: { Location: "https://storage.googleapis.com/bucket/pub-1.jpg" },
        }),
      ),
    );
    const r = await svc().download("pub-1");
    expect(r).toEqual({
      kind: "redirect",
      url: "https://storage.googleapis.com/bucket/pub-1.jpg",
    });
  });

  it("PRIVATE asset: returns { kind: 'bytes', data } with raw binary body", async () => {
    const expected = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    server.use(
      http.get("https://api.emporix.io/media/acme/assets/priv-1/download", () =>
        new HttpResponse(expected, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            ETag: '"v1"',
          },
        }),
      ),
    );
    const r = await svc().download("priv-1");
    expect(r.kind).toBe("bytes");
    if (r.kind === "bytes") {
      expect(new Uint8Array(r.data)).toEqual(expected);
      expect(r.contentType).toBe("application/pdf");
      expect(r.etag).toBe('"v1"');
    }
  });

  it("PRIVATE asset (text/plain + base64): decodes into ArrayBuffer transparently", async () => {
    const raw = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
    // base64 of "Hello" → "SGVsbG8="
    server.use(
      http.get("https://api.emporix.io/media/acme/assets/priv-b64/download", () =>
        new HttpResponse("SGVsbG8=", {
          status: 200,
          headers: { "Content-Type": "text/plain", ETag: '"v2"' },
        }),
      ),
    );
    const r = await svc().download("priv-b64");
    expect(r.kind).toBe("bytes");
    if (r.kind === "bytes") {
      expect(new Uint8Array(r.data)).toEqual(raw);
      expect(r.etag).toBe('"v2"');
    }
  });

  it("404: surfaces as EmporixNotFoundError", async () => {
    const { EmporixNotFoundError } = await import("../../src/core/errors");
    server.use(
      http.get("https://api.emporix.io/media/acme/assets/missing/download", () =>
        HttpResponse.json({ message: "not found" }, { status: 404 }),
      ),
    );
    await expect(svc().download("missing")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("3xx without Location: throws a descriptive EmporixError", async () => {
    const { EmporixError } = await import("../../src/core/errors");
    server.use(
      http.get("https://api.emporix.io/media/acme/assets/broken/download", () =>
        new HttpResponse(null, { status: 302 }),
      ),
    );
    await expect(svc().download("broken")).rejects.toBeInstanceOf(EmporixError);
  });
});
