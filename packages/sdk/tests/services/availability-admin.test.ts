import { describe, it, expect, vi, type Mock } from "vitest";
import { AvailabilityService } from "../../src/services/availability";

// `Mock`, not `ReturnType<typeof vi.fn>`: since vitest 4 that resolves to the
// constraint `Mock<Procedure | Constructable>`, which is not callable.
function ctxWith(request: Mock): ConstructorParameters<typeof AvailabilityService>[0] {
  return {
    tenant: "acme",
    // `requestWithMeta` is derived from the same stub so a paginated facade
    // (which goes through `core/paged.ts`) sees the same answers, with no
    // pagination headers.
    http: {
      request,
      requestWithMeta: async (o: unknown) => ({ data: await request(o), headers: new Headers() }),
    },
    tokenProvider: { getToken: vi.fn() },
    logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
const svc = (req: Mock): AvailabilityService => new AvailabilityService(ctxWith(req));
const A = "/availability/acme/availability";

describe("AvailabilityService.listForSite", () => {
  it("GETs the site path with ANON default and wraps into PaginatedItems", async () => {
    const l = vi.fn().mockResolvedValue([{ productId: "p1", available: true }]);
    const res = await svc(l).listForSite("main", { pageSize: 10, q: "available:true", sort: "productId" });
    expect(l).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: `${A}/site/main`,
        auth: { kind: "anonymous" },
        query: expect.objectContaining({ pageNumber: 1, pageSize: 10, q: "available:true", sort: "productId" }),
      }),
    );
    expect(res).toEqual({
      items: [{ productId: "p1", available: true }],
      pageNumber: 1,
      pageSize: 10,
      hasNextPage: false,
    });
  });
});

describe("AvailabilityService per-product writes", () => {
  it("create/update/delete hit the right method+path with SERVICE default", async () => {
    const c = vi.fn().mockResolvedValue({ id: "main:p1" });
    await svc(c).create("p1", "main", {} as never);
    expect(c).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST", path: `${A}/p1/main`, body: {}, auth: { kind: "service" } }),
    );

    const u = vi.fn().mockResolvedValue(undefined);
    await svc(u).update("p1", "main", {} as never);
    expect(u).toHaveBeenCalledWith(
      expect.objectContaining({ method: "PUT", path: `${A}/p1/main`, body: {}, auth: { kind: "service" } }),
    );

    const d = vi.fn().mockResolvedValue(undefined);
    await svc(d).delete("p1", "main");
    expect(d).toHaveBeenCalledWith(
      expect.objectContaining({ method: "DELETE", path: `${A}/p1/main`, auth: { kind: "service" } }),
    );
  });

  it("patch PATCHes the per-product path with the operation array and SERVICE default", async () => {
    const p = vi.fn().mockResolvedValue(undefined);
    const ops = [{ op: "REPLACE" as const, path: "/stockLevel", value: 42 }];
    await expect(svc(p).patch("p/1", "main", ops)).resolves.toBeUndefined();
    expect(p).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PATCH",
        path: `${A}/p%2F1/main`,
        body: [{ op: "REPLACE", path: "/stockLevel", value: 42 }],
        auth: { kind: "service" },
      }),
    );
  });

  it("escapes path segments and honors an explicit auth override", async () => {
    const c = vi.fn().mockResolvedValue({ id: "x" });
    await svc(c).create("p/1", "main", {} as never, { kind: "raw", token: "X" });
    expect(c).toHaveBeenCalledWith(
      expect.objectContaining({ path: `${A}/p%2F1/main`, auth: { kind: "raw", token: "X" } }),
    );
  });
});

describe("AvailabilityService bulk", () => {
  it("bulkCreate/bulkUpdate/bulkDelete hit /availability/bulk with a body", async () => {
    const c = vi.fn().mockResolvedValue([{ code: 201 }]);
    await svc(c).bulkCreate([{ productId: "p1" }] as never);
    expect(c).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: `${A}/bulk`,
        body: [{ productId: "p1" }],
        auth: { kind: "service" },
      }),
    );

    const u = vi.fn().mockResolvedValue([{ code: 200 }]);
    await svc(u).bulkUpdate([{ productId: "p1" }] as never);
    expect(u).toHaveBeenCalledWith(
      expect.objectContaining({ method: "PUT", path: `${A}/bulk`, body: [{ productId: "p1" }] }),
    );

    const d = vi.fn().mockResolvedValue([{ code: 204 }]);
    await svc(d).bulkDelete([{ productId: "p1", site: "main" }] as never);
    expect(d).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "DELETE",
        path: `${A}/bulk`,
        body: [{ productId: "p1", site: "main" }],
        auth: { kind: "service" },
      }),
    );
  });

  it("bulkPatch PATCHes /availability/bulk and returns the per-entry results", async () => {
    const results = [
      { id: "main:p1", index: 0, code: 204, status: "No Content" },
      { index: 1, code: 404, status: "Not Found" },
    ];
    const p = vi.fn().mockResolvedValue(results);
    const input = [
      { productId: "p1", site: "main", data: [{ op: "REPLACE" as const, path: "/stockLevel", value: 42 }] },
      { productId: "p2", site: "main", data: [{ op: "REMOVE" as const, path: "/stockLevel" }] },
    ];
    await expect(svc(p).bulkPatch(input)).resolves.toEqual(results);
    expect(p).toHaveBeenCalledWith(
      expect.objectContaining({ method: "PATCH", path: `${A}/bulk`, body: input, auth: { kind: "service" } }),
    );
    expect(p.mock.calls[0]?.[0]).not.toHaveProperty("headers");

    const v = vi.fn().mockResolvedValue([]);
    await svc(v).bulkPatch([], { vendorId: "v1" });
    expect(v).toHaveBeenCalledWith(expect.objectContaining({ headers: { "vendor-id": "v1" } }));
  });

  it("sends the vendor-id header only when vendorId is given", async () => {
    const withVendor = vi.fn().mockResolvedValue([]);
    await svc(withVendor).bulkCreate([] as never, { vendorId: "v1" });
    expect(withVendor).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { "vendor-id": "v1" } }),
    );

    const without = vi.fn().mockResolvedValue([]);
    await svc(without).bulkCreate([] as never);
    expect(without.mock.calls[0]?.[0]).not.toHaveProperty("headers");
  });
});
