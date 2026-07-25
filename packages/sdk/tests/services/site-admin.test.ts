import { describe, it, expect, vi } from "vitest";
import { SiteService } from "../../src/services/site";

function ctxWith(request: ReturnType<typeof vi.fn>): ConstructorParameters<typeof SiteService>[0] {
  return {
    tenant: "acme",
    http: { request },
    tokenProvider: { getToken: vi.fn() },
    logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
const svc = (req: ReturnType<typeof vi.fn>): SiteService => new SiteService(ctxWith(req));
const S = "/site/acme/sites";

describe("SiteService writes", () => {
  it("create/update/replace/delete hit the right method+path with SERVICE default", async () => {
    const c = vi.fn().mockResolvedValue({ id: "main" });
    await svc(c).create({} as never);
    expect(c).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST", path: S, body: {}, auth: { kind: "service" } }),
    );

    const u = vi.fn().mockResolvedValue(undefined);
    await svc(u).update("main", {} as never);
    expect(u).toHaveBeenCalledWith(
      expect.objectContaining({ method: "PATCH", path: `${S}/main`, body: {}, auth: { kind: "service" } }),
    );

    const r = vi.fn().mockResolvedValue(undefined);
    await svc(r).replace("main", {} as never);
    expect(r).toHaveBeenCalledWith(
      expect.objectContaining({ method: "PUT", path: `${S}/main`, body: {}, auth: { kind: "service" } }),
    );

    const d = vi.fn().mockResolvedValue(undefined);
    await svc(d).delete("main");
    expect(d).toHaveBeenCalledWith(
      expect.objectContaining({ method: "DELETE", path: `${S}/main`, auth: { kind: "service" } }),
    );
  });

  it("replace sends the expand query only when given", async () => {
    const withExpand = vi.fn().mockResolvedValue(undefined);
    await svc(withExpand).replace("main", {} as never, { expand: "mixins" });
    expect(withExpand).toHaveBeenCalledWith(expect.objectContaining({ query: { expand: "mixins" } }));

    const without = vi.fn().mockResolvedValue(undefined);
    await svc(without).replace("main", {} as never);
    expect(without.mock.calls[0]?.[0]).not.toHaveProperty("query");
  });

  it("listCodes GETs /siteslist with the ANON default", async () => {
    const l = vi.fn().mockResolvedValue(["main", "ch"]);
    const res = await svc(l).listCodes();
    expect(l).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: "/site/acme/siteslist", auth: { kind: "anonymous" } }),
    );
    expect(res).toEqual(["main", "ch"]);
  });

  it("honors an explicit auth override", async () => {
    const c = vi.fn().mockResolvedValue({ id: "main" });
    await svc(c).create({} as never, { kind: "raw", token: "X" });
    expect(c).toHaveBeenCalledWith(expect.objectContaining({ auth: { kind: "raw", token: "X" } }));
  });
});

describe("SiteService.mixins", () => {
  it("reads default to ANON", async () => {
    const l = vi.fn().mockResolvedValue({ seo: {} });
    await svc(l).mixins.list("main");
    expect(l).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: `${S}/main/mixins`, auth: { kind: "anonymous" } }),
    );

    const g = vi.fn().mockResolvedValue({ title: "x" });
    await svc(g).mixins.get("main", "seo");
    expect(g).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: `${S}/main/mixins/seo`, auth: { kind: "anonymous" } }),
    );
  });

  it("writes default to SERVICE", async () => {
    const c = vi.fn().mockResolvedValue({ id: "seo" });
    const res = await svc(c).mixins.create("main", { seo: {} });
    expect(c).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST", path: `${S}/main/mixins`, body: { seo: {} }, auth: { kind: "service" } }),
    );
    expect(res).toEqual({ id: "seo" });

    const u = vi.fn().mockResolvedValue(undefined);
    await svc(u).mixins.update("main", "seo", { title: "x" });
    expect(u).toHaveBeenCalledWith(
      expect.objectContaining({ method: "PATCH", path: `${S}/main/mixins/seo`, body: { title: "x" }, auth: { kind: "service" } }),
    );

    const r = vi.fn().mockResolvedValue(undefined);
    await svc(r).mixins.replace("main", "seo", { title: "y" });
    expect(r).toHaveBeenCalledWith(
      expect.objectContaining({ method: "PUT", path: `${S}/main/mixins/seo`, body: { title: "y" }, auth: { kind: "service" } }),
    );

    const d = vi.fn().mockResolvedValue(undefined);
    await svc(d).mixins.delete("main", "seo");
    expect(d).toHaveBeenCalledWith(
      expect.objectContaining({ method: "DELETE", path: `${S}/main/mixins/seo`, auth: { kind: "service" } }),
    );
  });
});
