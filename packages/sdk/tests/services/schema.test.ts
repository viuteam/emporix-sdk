import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { SchemaService } from "../../src/services/schema";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { EmporixNotFoundError } from "../../src/core/errors";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "schema" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new SchemaService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const SCHEMAS = "https://api.emporix.io/schema/acme/schemas";
const TYPES = "https://api.emporix.io/schema/acme/types";

describe("SchemaService — schemas (group A)", () => {
  it("listSchemas GETs with a service token and a paginated envelope", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(SCHEMAS, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json([
          { id: "s1", name: { en: "Product extras" }, types: ["PRODUCT"], attributes: [], metadata: { version: 1 } },
        ]);
      }),
    );
    const page = await svc().listSchemas();
    expect(seenAuth).toBe("Bearer svc-tok");
    expect(page.items.map((s) => s.id)).toEqual(["s1"]);
    expect(page.pageNumber).toBe(1);
    expect(page.pageSize).toBe(60);
    expect(page.hasNextPage).toBe(false);
  });

  it("listSchemas serializes q/type/pagination into the query", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.get(SCHEMAS, ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json([]);
      }),
    );
    await svc().listSchemas({ q: "name:x", type: "PRODUCT", pageNumber: 2, pageSize: 5 });
    const params = q as URLSearchParams | null;
    expect(params?.get("q")).toBe("name:x");
    expect(params?.get("type")).toBe("PRODUCT");
    expect(params?.get("pageNumber")).toBe("2");
    expect(params?.get("pageSize")).toBe("5");
  });

  it("getSchema fetches one schema by id", async () => {
    server.use(
      http.get(`${SCHEMAS}/s1`, () =>
        HttpResponse.json({ id: "s1", name: { en: "n" }, types: ["PRODUCT"], attributes: [], metadata: { version: 3 } }),
      ),
    );
    const s = await svc().getSchema("s1");
    expect(s.metadata?.version).toBe(3);
  });

  it("getSchema throws EmporixNotFoundError on 404", async () => {
    server.use(
      http.get(`${SCHEMAS}/missing`, () =>
        HttpResponse.json({ status: 404, message: "not found" }, { status: 404 }),
      ),
    );
    await expect(svc().getSchema("missing")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("createSchema POSTs the draft and returns the created schema", async () => {
    let body: unknown = null;
    server.use(
      http.post(SCHEMAS, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          { id: "s2", name: { en: "Extras" }, types: ["PRODUCT"], attributes: [], metadata: { version: 1 } },
          { status: 201 },
        );
      }),
    );
    const created = await svc().createSchema({ name: { en: "Extras" }, types: ["PRODUCT"], attributes: [] });
    expect(body).toEqual({ name: { en: "Extras" }, types: ["PRODUCT"], attributes: [] });
    expect(created.id).toBe("s2");
  });

  it("updateSchema PUTs the draft including metadata.version", async () => {
    let body: unknown = null;
    server.use(
      http.put(`${SCHEMAS}/s1`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "s1", name: { en: "n" }, types: ["PRODUCT"], attributes: [], metadata: { version: 4 } });
      }),
    );
    const updated = await svc().updateSchema("s1", {
      name: { en: "n" },
      types: ["PRODUCT"],
      attributes: [],
      metadata: { version: 3 },
    });
    expect(body).toEqual({ name: { en: "n" }, types: ["PRODUCT"], attributes: [], metadata: { version: 3 } });
    expect(updated.metadata?.version).toBe(4);
  });

  it("deleteSchema DELETEs and resolves to void", async () => {
    server.use(http.delete(`${SCHEMAS}/s1`, () => new HttpResponse(null, { status: 204 })));
    await expect(svc().deleteSchema("s1")).resolves.toBeUndefined();
  });

  it("validateSchemaFile POSTs to /schemas/file without persisting", async () => {
    let path = "";
    let body: unknown = null;
    server.use(
      http.post(`${SCHEMAS}/file`, async ({ request }) => {
        path = new URL(request.url).pathname;
        body = await request.json();
        return HttpResponse.json({ valid: true });
      }),
    );
    const res = await svc().validateSchemaFile({ name: { en: "n" }, types: ["PRODUCT"], attributes: [] });
    expect(path).toBe("/schema/acme/schemas/file");
    expect(body).toEqual({ name: { en: "n" }, types: ["PRODUCT"], attributes: [] });
    expect(res).toEqual({ valid: true });
  });

  it("encodeURIComponent-escapes the schema id in the path", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/schema/acme/schemas/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({ id: "a/b", name: {}, types: [], attributes: [], metadata: { version: 0 } });
      }),
    );
    await svc().getSchema("a/b");
    expect(pathname).toBe("/schema/acme/schemas/a%2Fb");
  });
});

describe("SchemaService — types (group B)", () => {
  it("listTypes returns the populated-types array", async () => {
    server.use(http.get(TYPES, () => HttpResponse.json(["PRODUCT", "CART"])));
    expect(await svc().listTypes()).toEqual(["PRODUCT", "CART"]);
  });

  it("setSchemaTypes PUTs the types body to /schemas/{id}/types", async () => {
    let body: unknown = null;
    server.use(
      http.put(`${SCHEMAS}/s1/types`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "s1", name: {}, types: ["PRODUCT", "CART"], attributes: [], metadata: { version: 2 } });
      }),
    );
    const updated = await svc().setSchemaTypes("s1", ["PRODUCT", "CART"]);
    expect(body).toEqual({ types: ["PRODUCT", "CART"] });
    expect(updated.types).toEqual(["PRODUCT", "CART"]);
  });
});

const ENTITIES = "https://api.emporix.io/schema/acme/custom-entities";

describe("SchemaService — custom entities (group C)", () => {
  it("listCustomEntities GETs the array and forwards expandSchemas", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.get(ENTITIES, ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json([{ id: "shoe", name: { en: "Shoe" }, attributes: [], metadata: { version: 1 } }]);
      }),
    );
    const rows = await svc().listCustomEntities({ expandSchemas: true });
    expect((q as URLSearchParams | null)?.get("expandSchemas")).toBe("true");
    expect(rows[0]?.id).toBe("shoe");
  });

  it("listCustomEntities omits the query when no options are given", async () => {
    let search = "x";
    server.use(
      http.get(ENTITIES, ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json([]);
      }),
    );
    await svc().listCustomEntities();
    expect(search).toBe("");
  });

  it("getCustomEntity fetches one by id", async () => {
    server.use(
      http.get(`${ENTITIES}/shoe`, () =>
        HttpResponse.json({ id: "shoe", name: { en: "Shoe" }, attributes: [], metadata: { version: 2 } }),
      ),
    );
    expect((await svc().getCustomEntity("shoe")).id).toBe("shoe");
  });

  it("createCustomEntity POSTs the draft", async () => {
    let body: unknown = null;
    server.use(
      http.post(ENTITIES, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "shoe", name: { en: "Shoe" }, attributes: [], metadata: { version: 1 } }, { status: 201 });
      }),
    );
    await svc().createCustomEntity({ name: { en: "Shoe" }, attributes: [] });
    expect(body).toEqual({ name: { en: "Shoe" }, attributes: [] });
  });

  it("updateCustomEntity PUTs the draft", async () => {
    let body: unknown = null;
    server.use(
      http.put(`${ENTITIES}/shoe`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "shoe", name: { en: "Sneaker" }, attributes: [], metadata: { version: 2 } });
      }),
    );
    const updated = await svc().updateCustomEntity("shoe", { name: { en: "Sneaker" }, attributes: [] });
    expect(body).toEqual({ name: { en: "Sneaker" }, attributes: [] });
    expect(updated.name).toEqual({ en: "Sneaker" });
  });

  it("deleteCustomEntity DELETEs and resolves to void", async () => {
    server.use(http.delete(`${ENTITIES}/shoe`, () => new HttpResponse(null, { status: 204 })));
    await expect(svc().deleteCustomEntity("shoe")).resolves.toBeUndefined();
  });
});

describe("SchemaService — custom instances (group D)", () => {
  const INSTANCES = `${ENTITIES}/shoe/instances`;

  it("listInstances GETs a paginated envelope for the type", async () => {
    server.use(
      http.get(INSTANCES, () =>
        HttpResponse.json([
          { id: "i1", name: { en: "n" }, type: "shoe", owner: { type: "SERVICE", userId: "u" }, mixins: { size: 42 }, metadata: { version: 1 } },
        ]),
      ),
    );
    const page = await svc().listInstances<{ size: number }>("shoe");
    expect(page.items[0]?.mixins.size).toBe(42);
    expect(page.pageNumber).toBe(1);
    expect(page.pageSize).toBe(60);
  });

  it("getInstance fetches one instance by id with typed mixins", async () => {
    server.use(
      http.get(`${INSTANCES}/i1`, () =>
        HttpResponse.json({ id: "i1", name: { en: "n" }, type: "shoe", owner: { type: "SERVICE", userId: "u" }, mixins: { size: 42 }, metadata: { version: 1 } }),
      ),
    );
    const inst = await svc().getInstance<{ size: number }>("shoe", "i1");
    expect(inst.mixins.size).toBe(42);
  });

  it("createInstance POSTs the draft", async () => {
    let body: unknown = null;
    server.use(
      http.post(INSTANCES, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "i2", name: { en: "n" }, type: "shoe", owner: { type: "SERVICE", userId: "u" }, mixins: { size: 41 }, metadata: { version: 1 } }, { status: 201 });
      }),
    );
    const created = await svc().createInstance("shoe", { name: { en: "n" }, mixins: { size: 41 } });
    expect(body).toEqual({ name: { en: "n" }, mixins: { size: 41 } });
    expect(created.id).toBe("i2");
  });

  it("replaceInstance PUTs the full draft", async () => {
    let method = "";
    let body: unknown = null;
    server.use(
      http.put(`${INSTANCES}/i1`, async ({ request }) => {
        method = request.method;
        body = await request.json();
        return HttpResponse.json({ id: "i1", name: { en: "n2" }, type: "shoe", owner: { type: "SERVICE", userId: "u" }, mixins: { size: 40 }, metadata: { version: 2 } });
      }),
    );
    await svc().replaceInstance("shoe", "i1", { name: { en: "n2" }, mixins: { size: 40 } });
    expect(method).toBe("PUT");
    expect(body).toEqual({ name: { en: "n2" }, mixins: { size: 40 } });
  });

  it("patchInstance PATCHes a partial body", async () => {
    let method = "";
    let body: unknown = null;
    server.use(
      http.patch(`${INSTANCES}/i1`, async ({ request }) => {
        method = request.method;
        body = await request.json();
        return HttpResponse.json({ id: "i1", name: { en: "n" }, type: "shoe", owner: { type: "SERVICE", userId: "u" }, mixins: { size: 39 }, metadata: { version: 3 } });
      }),
    );
    await svc().patchInstance("shoe", "i1", { mixins: { size: 39 } });
    expect(method).toBe("PATCH");
    expect(body).toEqual({ mixins: { size: 39 } });
  });

  it("deleteInstance DELETEs and resolves to void", async () => {
    server.use(http.delete(`${INSTANCES}/i1`, () => new HttpResponse(null, { status: 204 })));
    await expect(svc().deleteInstance("shoe", "i1")).resolves.toBeUndefined();
  });

  it("searchInstances POSTs the filter to /instances/search and wraps the result", async () => {
    let path = "";
    let body: unknown = null;
    server.use(
      http.post(`${INSTANCES}/search`, async ({ request }) => {
        path = new URL(request.url).pathname;
        body = await request.json();
        return HttpResponse.json([
          { id: "i1", name: { en: "n" }, type: "shoe", owner: { type: "SERVICE", userId: "u" }, mixins: { size: 42 }, metadata: { version: 1 } },
        ]);
      }),
    );
    const page = await svc().searchInstances("shoe", { size: { $gt: 40 } });
    expect(path).toBe("/schema/acme/custom-entities/shoe/instances/search");
    expect(body).toEqual({ size: { $gt: 40 } });
    expect(page.items[0]?.id).toBe("i1");
  });

  it("encodeURIComponent-escapes the type segment in the path", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/schema/acme/custom-entities/*/instances", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json([]);
      }),
    );
    await svc().listInstances("a/b");
    expect(pathname).toBe("/schema/acme/custom-entities/a%2Fb/instances");
  });
});
