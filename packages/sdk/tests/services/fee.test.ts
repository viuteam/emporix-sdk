import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { FeeService } from "../../src/services/fee";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "fee" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new FeeService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const FEES = "https://api.emporix.io/fee/acme/fees";
const ITEM = "https://api.emporix.io/fee/acme/itemFees";
const PROD = "https://api.emporix.io/fee/acme/productFees";

const aFee = {
  id: "fee_1",
  name: { en: "Small order fee" },
  code: "small-order",
  feeType: "PERCENT",
  feePercentage: 2.5,
  siteCode: "main",
  active: true,
  yrn: "urn:yaas:saasag:fee:acme;fee_1",
};

describe("FeeService", () => {
  it("list wraps fees in a PaginatedItems envelope with server defaults", async () => {
    let seenAuth: string | null = null;
    let q: URLSearchParams | null = null;
    server.use(
      http.get(FEES, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        q = new URL(request.url).searchParams;
        return HttpResponse.json([aFee]);
      }),
    );
    const page = await svc().list();
    expect(seenAuth).toBe("Bearer svc-tok");
    expect((q as URLSearchParams | null)?.get("pageNumber")).toBe("1");
    expect((q as URLSearchParams | null)?.get("pageSize")).toBe("60");
    expect(page.items[0]?.code).toBe("small-order");
    expect(page.pageNumber).toBe(1);
    expect(page.pageSize).toBe(60);
    expect(page.hasNextPage).toBe(false);
  });

  it("list reports hasNextPage when the page is full and passes q/sort through", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.get(FEES, ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json(Array.from({ length: 2 }, (_, i) => ({ ...aFee, id: `fee_${i}` })));
      }),
    );
    const page = await svc().list({ pageSize: 2, q: "siteCode:main", sort: "code:asc" });
    expect(page.hasNextPage).toBe(true);
    expect((q as URLSearchParams | null)?.get("q")).toBe("siteCode:main");
    expect((q as URLSearchParams | null)?.get("sort")).toBe("code:asc");
  });

  it("get fetches one fee by id", async () => {
    server.use(http.get(`${FEES}/fee_1`, () => HttpResponse.json(aFee)));
    const f = await svc().get("fee_1");
    expect(f.id).toBe("fee_1");
  });

  it("get throws EmporixNotFoundError on 404", async () => {
    server.use(
      http.get(`${FEES}/missing`, () =>
        HttpResponse.json({ status: 404, message: "not found" }, { status: 404 }),
      ),
    );
    await expect(svc().get("missing")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("create POSTs the draft and returns the created fee", async () => {
    let body: unknown = null;
    server.use(
      http.post(FEES, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(aFee, { status: 201 });
      }),
    );
    const draft = {
      name: { en: "Small order fee" },
      code: "small-order",
      feeType: "PERCENT" as const,
      feePercentage: 2.5,
      siteCode: "main",
      active: true,
    };
    const created = await svc().create(draft);
    expect(body).toEqual(draft);
    expect(created.id).toBe("fee_1");
  });

  it("update PUTs the draft to /fees/{id} and returns the updated fee", async () => {
    let body: unknown = null;
    server.use(
      http.put(`${FEES}/fee_1`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...aFee, active: false });
      }),
    );
    const updated = await svc().update("fee_1", {
      name: { en: "Small order fee" },
      code: "small-order",
      feeType: "PERCENT",
      feePercentage: 2.5,
      siteCode: "main",
      active: false,
    });
    expect((body as { active?: boolean }).active).toBe(false);
    expect(updated.active).toBe(false);
  });

  it("delete DELETEs the fee and resolves to void", async () => {
    server.use(http.delete(`${FEES}/fee_1`, () => new HttpResponse(null, { status: 204 })));
    await expect(svc().delete("fee_1")).resolves.toBeUndefined();
  });

  it("listItemFees GETs /itemFees", async () => {
    server.use(http.get(ITEM, () => HttpResponse.json([{ id: "if_1", itemYrn: "y", feeIds: ["fee_1"], siteCode: "main" }])));
    const rows = await svc().listItemFees();
    expect(rows[0]?.id).toBe("if_1");
  });

  it("getItemFees GETs /itemFees/{yrn}/fees", async () => {
    let pathname = "";
    server.use(
      http.get(`${ITEM}/:yrn/fees`, ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json([{ id: "if_1", itemYrn: "urn:p:1", feeIds: ["fee_1"], siteCode: "main" }]);
      }),
    );
    const rows = await svc().getItemFees("urn:p:1");
    expect(pathname).toBe("/fee/acme/itemFees/urn%3Ap%3A1/fees");
    expect(rows[0]?.feeIds).toEqual(["fee_1"]);
  });

  it("createItemFee POSTs the mapping body", async () => {
    let body: unknown = null;
    server.use(
      http.post(ITEM, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "if_1", itemYrn: "urn:p:1", feeIds: ["fee_1"], siteCode: "main" }, { status: 201 });
      }),
    );
    const created = await svc().createItemFee({ itemYrn: "urn:p:1", feeIds: ["fee_1"], siteCode: "main" });
    expect(body).toEqual({ itemYrn: "urn:p:1", feeIds: ["fee_1"], siteCode: "main" });
    expect(created.id).toBe("if_1");
  });

  it("setItemFees PUTs to /itemFees/{yrn}/fees (destructive by default)", async () => {
    let body: unknown = null;
    let search = "x";
    server.use(
      http.put(`${ITEM}/:yrn/fees`, async ({ request }) => {
        body = await request.json();
        search = new URL(request.url).search;
        return HttpResponse.json({ id: "if_1", itemYrn: "urn:p:1", feeIds: ["fee_1", "fee_2"], siteCode: "main" });
      }),
    );
    const res = await svc().setItemFees("urn:p:1", ["fee_1", "fee_2"]);
    expect(body).toEqual({ feeIds: ["fee_1", "fee_2"] });
    expect(search).toBe("");
    expect(res.feeIds).toEqual(["fee_1", "fee_2"]);
  });

  it("setItemFees with partial:true adds ?partial=true", async () => {
    let partial: string | null = null;
    server.use(
      http.put(`${ITEM}/:yrn/fees`, ({ request }) => {
        partial = new URL(request.url).searchParams.get("partial");
        return HttpResponse.json({ id: "if_1", itemYrn: "urn:p:1", feeIds: ["fee_2"], siteCode: "main" });
      }),
    );
    await svc().setItemFees("urn:p:1", ["fee_2"], { partial: true });
    expect(partial).toBe("true");
  });

  it("deleteItemFees(yrn) DELETEs all mappings for the YRN", async () => {
    let pathname = "";
    server.use(
      http.delete(`${ITEM}/:yrn/fees`, ({ request }) => {
        pathname = new URL(request.url).pathname;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(svc().deleteItemFees("urn:p:1")).resolves.toBeUndefined();
    expect(pathname).toBe("/fee/acme/itemFees/urn%3Ap%3A1/fees");
  });

  it("deleteItemFees(yrn, feeId) DELETEs a single fee from the mapping", async () => {
    let pathname = "";
    server.use(
      http.delete(`${ITEM}/:yrn/fees/:feeId`, ({ request }) => {
        pathname = new URL(request.url).pathname;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(svc().deleteItemFees("urn:p:1", "fee_1")).resolves.toBeUndefined();
    expect(pathname).toBe("/fee/acme/itemFees/urn%3Ap%3A1/fees/fee_1");
  });

  it("searchItemFees POSTs {itemYrns,siteCode} to /itemFees/search", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${ITEM}/search`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json([{ id: "if_1", itemYrn: "urn:p:1", feeIds: ["fee_1"], siteCode: "main" }]);
      }),
    );
    const rows = await svc().searchItemFees({ itemYrns: ["urn:p:1"], siteCode: "main" });
    expect(body).toEqual({ itemYrns: ["urn:p:1"], siteCode: "main" });
    expect(rows[0]?.id).toBe("if_1");
  });

  it("getProductFees / setProductFees / deleteProductFees hit /productFees/{id}/fees", async () => {
    let putBody: unknown = null;
    server.use(
      http.get(`${PROD}/p1/fees`, () => HttpResponse.json([{ id: "pf_1", itemYrn: "urn:p:1", feeIds: ["fee_1"], siteCode: "main" }])),
      http.put(`${PROD}/p1/fees`, async ({ request }) => {
        putBody = await request.json();
        return HttpResponse.json({ id: "pf_1", itemYrn: "urn:p:1", feeIds: ["fee_1"], siteCode: "main" });
      }),
      http.delete(`${PROD}/p1/fees`, () => new HttpResponse(null, { status: 204 })),
    );
    const got = await svc().getProductFees("p1");
    expect(got[0]?.id).toBe("pf_1");
    await svc().setProductFees("p1", ["fee_1"]);
    expect(putBody).toEqual({ feeIds: ["fee_1"] });
    await expect(svc().deleteProductFees("p1")).resolves.toBeUndefined();
  });
});
