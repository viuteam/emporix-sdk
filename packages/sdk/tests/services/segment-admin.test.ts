import { describe, it, expect, vi } from "vitest";
import { SegmentService } from "../../src/services/segment";

function ctxWith(request: ReturnType<typeof vi.fn>): ConstructorParameters<typeof SegmentService>[0] {
  return {
    tenant: "acme",
    http: { request },
    tokenProvider: { getToken: vi.fn() },
    logger: {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const deps = { products: {} as any, categories: {} as any };
const svc = (req: ReturnType<typeof vi.fn>): SegmentService => new SegmentService(ctxWith(req), deps);
const B = "/customer-segment/acme/segments";

describe("SegmentService segment core admin", () => {
  it("create/search/update/patch/delete/match/bulk hit the right method+path with SERVICE default", async () => {
    const c = vi.fn().mockResolvedValue({ id: "s1" });
    await svc(c).create({} as never);
    expect(c).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: B, auth: { kind: "service" } }));

    const s = vi.fn().mockResolvedValue([{ id: "s1" }]);
    await svc(s).search({} as never);
    expect(s).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: `${B}/search` }));

    const u = vi.fn().mockResolvedValue({ id: "s1" });
    await svc(u).update("s1", {} as never);
    expect(u).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: `${B}/s1` }));

    const p = vi.fn().mockResolvedValue({ id: "s1" });
    await svc(p).patch("s1", {} as never);
    expect(p).toHaveBeenCalledWith(expect.objectContaining({ method: "PATCH", path: `${B}/s1` }));

    const d = vi.fn().mockResolvedValue(undefined);
    await svc(d).delete("s1");
    expect(d).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: `${B}/s1` }));

    const m = vi.fn().mockResolvedValue([{ id: "s1" }]);
    await svc(m).match({} as never);
    expect(m).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: `${B}/match` }));

    const bc = vi.fn().mockResolvedValue([{ status: 201 }]);
    await svc(bc).bulkCreate([] as never);
    expect(bc).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: `${B}/bulk` }));

    const bu = vi.fn().mockResolvedValue([{ status: 200 }]);
    await svc(bu).bulkUpdate([] as never);
    expect(bu).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: `${B}/bulk` }));

    const bd = vi.fn().mockResolvedValue([{ status: 204 }]);
    await svc(bd).bulkDelete({} as never);
    expect(bd).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: `${B}/bulk` }));
  });

  it("honors an explicit auth override", async () => {
    const r = vi.fn().mockResolvedValue({ id: "s1" });
    await svc(r).create({} as never, { kind: "raw", token: "T" });
    expect(r).toHaveBeenCalledWith(expect.objectContaining({ auth: { kind: "raw", token: "T" } }));
  });
});

describe("segments.customers", () => {
  it("B2C + B2B + bulk hit the right method+path", async () => {
    const l = vi.fn().mockResolvedValue([{ id: "c1" }]);
    await svc(l).customers.list("s1");
    expect(l).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: `${B}/s1/customers`, auth: { kind: "service" } }));

    const se = vi.fn().mockResolvedValue([{ id: "c1" }]);
    await svc(se).customers.search("s1", {});
    expect(se).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: `${B}/s1/customers/search` }));

    const g = vi.fn().mockResolvedValue({ id: "c1" });
    await svc(g).customers.get("s1", "c1");
    expect(g).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: `${B}/s1/customers/c1` }));

    const a = vi.fn().mockResolvedValue({ id: "c1" });
    await svc(a).customers.assign("s1", "c1", {} as never);
    expect(a).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: `${B}/s1/customers/c1` }));

    const r = vi.fn().mockResolvedValue(undefined);
    await svc(r).customers.remove("s1", "c1");
    expect(r).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: `${B}/s1/customers/c1` }));

    const ge = vi.fn().mockResolvedValue({ id: "c1" });
    await svc(ge).customers.getForEntity("s1", "c1", "le1");
    expect(ge).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: `${B}/s1/customers/c1/le1` }));

    const ae = vi.fn().mockResolvedValue({ id: "c1" });
    await svc(ae).customers.assignForEntity("s1", "c1", "le1", {} as never);
    expect(ae).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: `${B}/s1/customers/c1/le1` }));

    const re = vi.fn().mockResolvedValue(undefined);
    await svc(re).customers.removeForEntity("s1", "c1", "le1");
    expect(re).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: `${B}/s1/customers/c1/le1` }));

    const ba = vi.fn().mockResolvedValue([{ status: 200 }]);
    await svc(ba).customers.bulkAssign("s1", [] as never);
    expect(ba).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: `${B}/s1/customers/bulk` }));

    const br = vi.fn().mockResolvedValue([{ status: 204 }]);
    await svc(br).customers.bulkRemove("s1", {} as never);
    expect(br).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: `${B}/s1/customers/bulk` }));
  });
});

describe("segments.items", () => {
  it("assignment ops hit /items/{type}...", async () => {
    const s = vi.fn().mockResolvedValue([{ id: "i1" }]);
    await svc(s).items.search("s1", {});
    expect(s).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: `${B}/s1/items/search`, auth: { kind: "service" } }));

    const g = vi.fn().mockResolvedValue({ id: "i1" });
    await svc(g).items.get("s1", "PRODUCT", "p1");
    expect(g).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: `${B}/s1/items/PRODUCT/p1` }));

    const a = vi.fn().mockResolvedValue({ id: "i1" });
    await svc(a).items.assign("s1", "PRODUCT", "p1", {} as never);
    expect(a).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: `${B}/s1/items/PRODUCT/p1` }));

    const r = vi.fn().mockResolvedValue(undefined);
    await svc(r).items.remove("s1", "PRODUCT", "p1");
    expect(r).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: `${B}/s1/items/PRODUCT/p1` }));

    const ba = vi.fn().mockResolvedValue([{ status: 200 }]);
    await svc(ba).items.bulkAssign("s1", "PRODUCT", [] as never);
    expect(ba).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: `${B}/s1/items/PRODUCT/bulk` }));

    const br = vi.fn().mockResolvedValue([{ status: 204 }]);
    await svc(br).items.bulkRemove("s1", "PRODUCT", {} as never);
    expect(br).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: `${B}/s1/items/PRODUCT/bulk` }));
  });
});
