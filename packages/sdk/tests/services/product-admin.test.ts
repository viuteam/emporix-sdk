import { describe, it, expect, vi } from "vitest";
import { ProductService } from "../../src/services/product";

function ctxWith(request: ReturnType<typeof vi.fn>): ConstructorParameters<typeof ProductService>[0] {
  return {
    tenant: "acme",
    http: { request },
    tokenProvider: { getToken: vi.fn() },
    logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
const svc = (req: ReturnType<typeof vi.fn>): ProductService => new ProductService(ctxWith(req));
const B = "/product/acme/products";
const T = "/product/acme/product-templates";

describe("ProductService write CRUD", () => {
  it("create/update/replace/delete hit the right method+path with SERVICE default", async () => {
    const c = vi.fn().mockResolvedValue({ id: "p1" });
    await svc(c).create({} as never);
    expect(c).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: B, auth: { kind: "service" } }));

    const u = vi.fn().mockResolvedValue(undefined);
    await svc(u).update("p1", {} as never);
    expect(u).toHaveBeenCalledWith(expect.objectContaining({ method: "PATCH", path: `${B}/p1`, auth: { kind: "service" } }));

    const r = vi.fn().mockResolvedValue({ id: "p1" });
    await svc(r).replace("p1", {} as never);
    expect(r).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: `${B}/p1`, auth: { kind: "service" } }));

    const d = vi.fn().mockResolvedValue(undefined);
    await svc(d).delete("p1");
    expect(d).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: `${B}/p1`, auth: { kind: "service" } }));
  });

  it("stringifies the boolean write flags into the query", async () => {
    const c = vi.fn().mockResolvedValue({ id: "p1" });
    await svc(c).create({} as never, { doIndex: true, skipVariantGeneration: false });
    expect(c).toHaveBeenCalledWith(
      expect.objectContaining({ query: { doIndex: "true", skipVariantGeneration: "false" } }),
    );

    const r = vi.fn().mockResolvedValue(undefined);
    await svc(r).replace("p1", {} as never, { partial: true });
    expect(r).toHaveBeenCalledWith(expect.objectContaining({ query: { partial: "true" } }));

    const d = vi.fn().mockResolvedValue(undefined);
    await svc(d).delete("p1", { force: true });
    expect(d).toHaveBeenCalledWith(expect.objectContaining({ query: { force: "true" } }));
  });

  it("omits the query entirely when no flags are given", async () => {
    const c = vi.fn().mockResolvedValue({ id: "p1" });
    await svc(c).create({} as never);
    expect(c.mock.calls[0]?.[0]).not.toHaveProperty("query");
  });

  it("honors an explicit auth override", async () => {
    const c = vi.fn().mockResolvedValue({ id: "p1" });
    await svc(c).create({} as never, {}, { kind: "raw", token: "X" });
    expect(c).toHaveBeenCalledWith(expect.objectContaining({ auth: { kind: "raw", token: "X" } }));
  });
});

describe("ProductService bulk + recalculation", () => {
  it("bulkCreate POSTs and bulkUpdate PUTs /products/bulk", async () => {
    const bc = vi.fn().mockResolvedValue([{ status: 201 }]);
    await svc(bc).bulkCreate([] as never);
    expect(bc).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: `${B}/bulk`, body: [], auth: { kind: "service" } }));

    const bu = vi.fn().mockResolvedValue([{ status: 200 }]);
    await svc(bu).bulkUpdate([] as never);
    expect(bu).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: `${B}/bulk`, body: [], auth: { kind: "service" } }));
  });

  it("recalculate POSTs /products/recalculate with the productIds body", async () => {
    const r = vi.fn().mockResolvedValue({ jobs: [], skippedProductIds: [] });
    const res = await svc(r).recalculate({ productIds: ["p1"] });
    expect(r).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST", path: `${B}/recalculate`, body: { productIds: ["p1"] }, auth: { kind: "service" } }),
    );
    expect(res).toEqual({ jobs: [], skippedProductIds: [] });
  });

  it("job reads GET the jobs paths with ANON default and forward a status filter", async () => {
    const l = vi.fn().mockResolvedValue([{ id: "j1" }]);
    await svc(l).listRecalculationJobs({ status: "PENDING" });
    expect(l).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: `${B}/recalculate/jobs`, query: { status: "PENDING" }, auth: { kind: "anonymous" } }),
    );

    const g = vi.fn().mockResolvedValue({ id: "j1" });
    await svc(g).getRecalculationJob("j1");
    expect(g).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: `${B}/recalculate/jobs/j1`, auth: { kind: "anonymous" } }));
  });
});

describe("ProductService.templates", () => {
  it("reads default to ANON and hit the template paths", async () => {
    const l = vi.fn().mockResolvedValue([{ id: "t1" }]);
    await svc(l).templates.list({ pageSize: 10, q: "name:Shirt" });
    expect(l).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: T,
        auth: { kind: "anonymous" },
        query: expect.objectContaining({ pageSize: 10, q: "name:Shirt" }),
      }),
    );

    const g = vi.fn().mockResolvedValue({ id: "t1" });
    await svc(g).templates.get("t1");
    expect(g).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: `${T}/t1`, auth: { kind: "anonymous" } }));
  });

  it("writes default to SERVICE and hit the template paths", async () => {
    const c = vi.fn().mockResolvedValue({ id: "t1" });
    const res = await svc(c).templates.create({} as never);
    expect(c).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: T, body: {}, auth: { kind: "service" } }));
    expect(res).toEqual({ id: "t1" });

    const u = vi.fn().mockResolvedValue(undefined);
    await svc(u).templates.update("t1", {} as never);
    expect(u).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: `${T}/t1`, body: {}, auth: { kind: "service" } }));

    const d = vi.fn().mockResolvedValue(undefined);
    await svc(d).templates.delete("t1");
    expect(d).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: `${T}/t1`, auth: { kind: "service" } }));
  });
});
