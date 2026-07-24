import { describe, it, expect, vi } from "vitest";
import { CategoryService } from "../../src/services/category";

function ctxWith(request: ReturnType<typeof vi.fn>): ConstructorParameters<typeof CategoryService>[0] {
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
const svc = (req: ReturnType<typeof vi.fn>): CategoryService => new CategoryService(ctxWith(req));
const B = "/category/acme/categories";

describe("CategoryService admin core CRUD", () => {
  it("create/update/patch/delete hit the right method+path with SERVICE default", async () => {
    const c = vi.fn().mockResolvedValue({ id: "c1" });
    await svc(c).create({} as never);
    expect(c).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: B, auth: { kind: "service" } }));

    const u = vi.fn().mockResolvedValue({ id: "c1" });
    await svc(u).update("c1", {} as never);
    expect(u).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: `${B}/c1`, auth: { kind: "service" } }));

    const p = vi.fn().mockResolvedValue(undefined);
    await svc(p).patch("c1", {} as never);
    expect(p).toHaveBeenCalledWith(expect.objectContaining({ method: "PATCH", path: `${B}/c1`, auth: { kind: "service" } }));

    const d = vi.fn().mockResolvedValue(undefined);
    await svc(d).delete("c1");
    expect(d).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: `${B}/c1`, auth: { kind: "service" } }));
  });

  it("maps the publish option to the query flag", async () => {
    const c = vi.fn().mockResolvedValue({ id: "c1" });
    await svc(c).create({} as never, { publish: true });
    expect(c).toHaveBeenCalledWith(expect.objectContaining({ query: { publish: "true" } }));
  });

  it("honors an explicit auth override", async () => {
    const r = vi.fn().mockResolvedValue({ id: "c1" });
    await svc(r).create({} as never, {}, { kind: "raw", token: "T" });
    expect(r).toHaveBeenCalledWith(expect.objectContaining({ auth: { kind: "raw", token: "T" } }));
  });
});

describe("CategoryService search reads", () => {
  it("searchByQuery POSTs /categories/search with a resolved q body and ANON default", async () => {
    const s = vi.fn().mockResolvedValue([{ id: "c1" }]);
    const res = await svc(s).searchByQuery("name:Shoes");
    expect(s).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: `${B}/search`,
        body: { q: "name:Shoes" },
        auth: { kind: "anonymous" },
      }),
    );
    expect(res.items).toEqual([{ id: "c1" }]);
    expect(res.hasNextPage).toBe(false);
  });

  it("searchByQuery forwards optional query flags", async () => {
    const s = vi.fn().mockResolvedValue([]);
    await svc(s).searchByQuery("*", { showRoots: true, sort: "position:ASC" });
    expect(s).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ showRoots: "true", sort: "position:ASC" }),
      }),
    );
  });

  it("searchTrees POSTs /category-trees/search", async () => {
    const t = vi.fn().mockResolvedValue([{ id: "root" }]);
    await svc(t).searchTrees({ categoryIds: ["c1"] });
    expect(t).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/category/acme/category-trees/search",
        body: { categoryIds: ["c1"] },
        auth: { kind: "anonymous" },
      }),
    );
  });
});

describe("CategoryService.assignments", () => {
  it("category-bound assignment ops hit the right method+path", async () => {
    const l = vi.fn().mockResolvedValue([{ id: "a1" }]);
    await svc(l).assignments.list("c1");
    expect(l).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: `${B}/c1/assignments`, auth: { kind: "anonymous" } }));

    const cr = vi.fn().mockResolvedValue({ id: "a1" });
    await svc(cr).assignments.create("c1", { ref: { id: "p1", type: "PRODUCT" } });
    expect(cr).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: `${B}/c1/assignments`, auth: { kind: "service" } }));

    const bc = vi.fn().mockResolvedValue([{ status: "201" }]);
    await svc(bc).assignments.bulkCreate("c1", [{ ref: { id: "p1", type: "PRODUCT" } }]);
    expect(bc).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: `${B}/c1/assignments/bulk`, auth: { kind: "service" } }));

    const rm = vi.fn().mockResolvedValue(undefined);
    await svc(rm).assignments.remove("c1", "a1");
    expect(rm).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: `${B}/c1/assignments/a1`, auth: { kind: "service" } }));

    const ra = vi.fn().mockResolvedValue(undefined);
    await svc(ra).assignments.removeAll("c1", { assignmentType: "PRODUCT" });
    expect(ra).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: `${B}/c1/assignments`, query: { assignmentType: "PRODUCT" } }));
  });

  it("reference-based assignment ops hit /assignments/references/...", async () => {
    const up = vi.fn().mockResolvedValue({ id: "a1" });
    await svc(up).assignments.upsertByReference("c1", "p1");
    expect(up).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: `${B}/c1/assignments/references/p1`, auth: { kind: "service" } }));
    expect(up.mock.calls[0]?.[0]).not.toHaveProperty("body");

    const rr = vi.fn().mockResolvedValue(undefined);
    await svc(rr).assignments.removeByReference("c1", "p1");
    expect(rr).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: `${B}/c1/assignments/references/p1` }));

    const bu = vi.fn().mockResolvedValue([{ status: "200" }]);
    await svc(bu).assignments.bulkUpsertByReference("c1", [{ ref: { id: "p1" } }]);
    expect(bu).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: `${B}/c1/assignments/references/bulk`, auth: { kind: "service" } }));
  });

  it("tenant-level reference ops target /assignments/references/{id}", async () => {
    const lc = vi.fn().mockResolvedValue([{ id: "c1" }]);
    await svc(lc).assignments.listCategoriesByReference("p1");
    expect(lc).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/category/acme/assignments/references/p1", auth: { kind: "anonymous" } }));

    const rl = vi.fn().mockResolvedValue(undefined);
    await svc(rl).assignments.removeAllByReference("p1");
    expect(rl).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: "/category/acme/assignments/references/p1", auth: { kind: "service" } }));
  });
});
