import { describe, it, expect, vi } from "vitest";
import { SchemaService } from "../../src/services/schema";

function ctxWith(request: ReturnType<typeof vi.fn>): ConstructorParameters<typeof SchemaService>[0] {
  return {
    tenant: "acme",
    http: { request },
    tokenProvider: { getToken: vi.fn() },
    logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
const svc = (req: ReturnType<typeof vi.fn>): SchemaService => new SchemaService(ctxWith(req));
const R = "/schema/acme/references";
const E = "/schema/acme/custom-entities";

describe("SchemaService.references", () => {
  it("list wraps into PaginatedItems and forwards filters", async () => {
    const l = vi.fn().mockResolvedValue([{ id: "r1" }]);
    const res = await svc(l).references.list({ pageSize: 10, type: "PRODUCT", q: "name:x" });
    expect(l).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: R,
        auth: { kind: "service" },
        query: expect.objectContaining({ pageNumber: 1, pageSize: 10, type: "PRODUCT", q: "name:x" }),
      }),
    );
    expect(res).toEqual({ items: [{ id: "r1" }], pageNumber: 1, pageSize: 10, hasNextPage: false });
  });

  it("get and delete hit /references/{id}", async () => {
    const g = vi.fn().mockResolvedValue({ id: "r1" });
    await svc(g).references.get("r1");
    expect(g).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: `${R}/r1`, auth: { kind: "service" } }),
    );

    const d = vi.fn().mockResolvedValue(undefined);
    await svc(d).references.delete("r1");
    expect(d).toHaveBeenCalledWith(
      expect.objectContaining({ method: "DELETE", path: `${R}/r1`, auth: { kind: "service" } }),
    );
  });

  it("create posts multipart with file and body parts", async () => {
    const c = vi.fn().mockResolvedValue({ id: "r1" });
    await svc(c).references.create({
      file: { some: "schema" },
      body: { name: { en: "Ref" } } as never,
    });
    const call = c.mock.calls[0]?.[0];
    expect(call).toEqual(expect.objectContaining({ method: "POST", path: R, auth: { kind: "service" } }));
    const fd = call.body as FormData;
    expect(fd).toBeInstanceOf(FormData);
    expect(fd.get("body")).toBe(JSON.stringify({ name: { en: "Ref" } }));
    const filePart = fd.get("file") as Blob;
    expect(filePart).toBeInstanceOf(Blob);
    expect(await filePart.text()).toBe(JSON.stringify({ some: "schema" }));
  });

  it("create forwards a Blob file unchanged", async () => {
    const c = vi.fn().mockResolvedValue({ id: "r1" });
    const blob = new Blob(["raw"], { type: "application/json" });
    await svc(c).references.create({ file: blob, body: {} as never });
    const fd = c.mock.calls[0]?.[0].body as FormData;
    expect(await (fd.get("file") as Blob).text()).toBe("raw");
  });

  it("update PUTs multipart and sends version only when given", async () => {
    const u = vi.fn().mockResolvedValue(undefined);
    await svc(u).references.update("r1", { file: {}, body: {} as never }, { version: 3 });
    expect(u).toHaveBeenCalledWith(
      expect.objectContaining({ method: "PUT", path: `${R}/r1`, query: { version: 3 } }),
    );

    const without = vi.fn().mockResolvedValue(undefined);
    await svc(without).references.update("r1", { file: {}, body: {} as never });
    expect(without.mock.calls[0]?.[0]).not.toHaveProperty("query");
  });
});

describe("SchemaService instance bulk", () => {
  it("bulkCreate POSTs, bulkUpsert PUTs, bulkDelete DELETEs with an id-array body", async () => {
    const B = `${E}/product/instances/bulk`;

    const c = vi.fn().mockResolvedValue([{ index: 0, code: 201 }]);
    await svc(c).bulkCreateInstances("product", [{ name: { en: "a" } }] as never);
    expect(c).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST", path: B, body: [{ name: { en: "a" } }], auth: { kind: "service" } }),
    );

    const u = vi.fn().mockResolvedValue([{ index: 0, code: 200 }]);
    await svc(u).bulkUpsertInstances("product", [{ id: "i1" }] as never);
    expect(u).toHaveBeenCalledWith(
      expect.objectContaining({ method: "PUT", path: B, body: [{ id: "i1" }], auth: { kind: "service" } }),
    );

    const d = vi.fn().mockResolvedValue([{ index: 0, code: 204 }]);
    const res = await svc(d).bulkDeleteInstances("product", ["i1", "i2"]);
    expect(d).toHaveBeenCalledWith(
      expect.objectContaining({ method: "DELETE", path: B, body: ["i1", "i2"], auth: { kind: "service" } }),
    );
    expect(res).toEqual([{ index: 0, code: 204 }]);
  });

  it("escapes the type in the bulk path", async () => {
    const c = vi.fn().mockResolvedValue([]);
    await svc(c).bulkCreateInstances("my type", [] as never);
    expect(c).toHaveBeenCalledWith(
      expect.objectContaining({ path: `${E}/my%20type/instances/bulk` }),
    );
  });
});

describe("SchemaService export/import", () => {
  it("exportCustomEntities POSTs the type array", async () => {
    const e = vi.fn().mockResolvedValue({ data: "YmFzZTY0", exportedAt: "2026-07-25T00:00:00Z" });
    const res = await svc(e).exportCustomEntities(["product", "recipe"]);
    expect(e).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: `${E}/export`,
        body: ["product", "recipe"],
        auth: { kind: "service" },
      }),
    );
    expect(res).toEqual({ data: "YmFzZTY0", exportedAt: "2026-07-25T00:00:00Z" });
  });

  it("importCustomEntities POSTs the data envelope", async () => {
    const i = vi.fn().mockResolvedValue(undefined);
    await svc(i).importCustomEntities({ data: "YmFzZTY0" });
    expect(i).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: `${E}/import`,
        body: { data: "YmFzZTY0" },
        auth: { kind: "service" },
      }),
    );
  });
});
