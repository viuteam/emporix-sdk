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
