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
