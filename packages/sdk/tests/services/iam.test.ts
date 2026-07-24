import { describe, it, expect, vi } from "vitest";
import { IamService } from "../../src/services/iam";

const AUTH = { kind: "raw", token: "T" } as const;

function ctxWith(request: ReturnType<typeof vi.fn>): ConstructorParameters<typeof IamService>[0] {
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

describe("IamService scaffold", () => {
  it("exposes the four sub-resources", () => {
    const iam = new IamService(ctxWith(vi.fn()));
    expect(typeof iam.users).toBe("object");
    expect(typeof iam.groups).toBe("object");
    expect(typeof iam.accessControls).toBe("object");
    expect(typeof iam.scopes).toBe("object");
  });
});

describe("iam.accessControls", () => {
  it("list GETs /access-controls with the bearer", async () => {
    const r = vi.fn().mockResolvedValue([{ id: "ac1" }]);
    const out = await new IamService(ctxWith(r)).accessControls.list(AUTH);
    expect(out[0]?.id).toBe("ac1");
    expect(r).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: "/iam/acme/access-controls", auth: AUTH }),
    );
  });

  it("get / upsert / delete hit /access-controls/{id}", async () => {
    const g = vi.fn().mockResolvedValue({ id: "ac1" });
    await new IamService(ctxWith(g)).accessControls.get("ac1", AUTH);
    expect(g).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: "/iam/acme/access-controls/ac1" }),
    );

    const u = vi.fn().mockResolvedValue({ id: "ac1" });
    await new IamService(ctxWith(u)).accessControls.upsert("ac1", {} as never, AUTH);
    expect(u).toHaveBeenCalledWith(
      expect.objectContaining({ method: "PUT", path: "/iam/acme/access-controls/ac1" }),
    );

    const d = vi.fn().mockResolvedValue(undefined);
    await new IamService(ctxWith(d)).accessControls.delete("ac1", AUTH);
    expect(d).toHaveBeenCalledWith(
      expect.objectContaining({ method: "DELETE", path: "/iam/acme/access-controls/ac1" }),
    );
  });
});

describe("iam.scopes", () => {
  it("list / get / upsertCustom / deleteCustom", async () => {
    const l = vi.fn().mockResolvedValue([{ id: "s1" }]);
    await new IamService(ctxWith(l)).scopes.list(AUTH);
    expect(l).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/iam/acme/scopes" }));

    const g = vi.fn().mockResolvedValue({ id: "s1" });
    await new IamService(ctxWith(g)).scopes.get("s1", AUTH);
    expect(g).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/iam/acme/scopes/s1" }));

    const u = vi.fn().mockResolvedValue({ id: "s1" });
    await new IamService(ctxWith(u)).scopes.upsertCustom("s1", {} as never, AUTH);
    expect(u).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: "/iam/acme/scopes/s1" }));

    const d = vi.fn().mockResolvedValue(undefined);
    await new IamService(ctxWith(d)).scopes.deleteCustom("s1", AUTH);
    expect(d).toHaveBeenCalledWith(
      expect.objectContaining({ method: "DELETE", path: "/iam/acme/scopes/s1" }),
    );
  });
});

describe("iam.users", () => {
  it("core CRUD hits the right method/path", async () => {
    const l = vi.fn().mockResolvedValue([{ id: "u1" }]);
    await new IamService(ctxWith(l)).users.list(AUTH);
    expect(l).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/iam/acme/users" }));

    const c = vi.fn().mockResolvedValue({ id: "u1" });
    await new IamService(ctxWith(c)).users.create({} as never, AUTH);
    expect(c).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: "/iam/acme/users" }));

    const g = vi.fn().mockResolvedValue({ id: "u1" });
    await new IamService(ctxWith(g)).users.get("u1", AUTH);
    expect(g).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/iam/acme/users/u1" }));

    const me = vi.fn().mockResolvedValue({ id: "me" });
    await new IamService(ctxWith(me)).users.getMe(AUTH);
    expect(me).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/iam/acme/users/me" }));

    const u = vi.fn().mockResolvedValue(undefined);
    await new IamService(ctxWith(u)).users.update("u1", {} as never, AUTH);
    expect(u).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: "/iam/acme/users/u1" }));

    const d = vi.fn().mockResolvedValue(undefined);
    await new IamService(ctxWith(d)).users.delete("u1", AUTH);
    expect(d).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: "/iam/acme/users/u1" }));
  });

  it("scoped reads hit the right sub-paths", async () => {
    const cases: [(iam: IamService) => Promise<unknown>, string][] = [
      [(i) => i.users.getGroups("u1", AUTH), "/iam/acme/users/u1/groups"],
      [(i) => i.users.getScopes("u1", AUTH), "/iam/acme/users/u1/scopes"],
      [(i) => i.users.getMyScopes(AUTH), "/iam/acme/users/me/scopes"],
      [(i) => i.users.getAccessControls("u1", AUTH), "/iam/acme/users/u1/access-controls"],
      [(i) => i.users.getMyAccessControls(AUTH), "/iam/acme/users/me/access-controls"],
    ];
    for (const [call, path] of cases) {
      const r = vi.fn().mockResolvedValue([]);
      await call(new IamService(ctxWith(r)));
      expect(r).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path }));
    }
  });
});

describe("iam.groups", () => {
  it("group CRUD", async () => {
    const l = vi.fn().mockResolvedValue([{ id: "g1" }]);
    await new IamService(ctxWith(l)).groups.list(AUTH, { "b2b.legalEntityId": "le1" });
    expect(l).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/iam/acme/groups",
        query: { "b2b.legalEntityId": "le1" },
      }),
    );

    const c = vi.fn().mockResolvedValue({ id: "g1" });
    await new IamService(ctxWith(c)).groups.create({} as never, AUTH);
    expect(c).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: "/iam/acme/groups" }));

    const g = vi.fn().mockResolvedValue({ id: "g1" });
    await new IamService(ctxWith(g)).groups.get("g1", AUTH);
    expect(g).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/iam/acme/groups/g1" }));

    const u = vi.fn().mockResolvedValue(undefined);
    await new IamService(ctxWith(u)).groups.update("g1", {} as never, AUTH);
    expect(u).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: "/iam/acme/groups/g1" }));

    const d = vi.fn().mockResolvedValue(undefined);
    await new IamService(ctxWith(d)).groups.delete("g1", AUTH);
    expect(d).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: "/iam/acme/groups/g1" }));
  });

  it("membership + access-controls", async () => {
    const lu = vi.fn().mockResolvedValue([{ id: "u1" }]);
    await new IamService(ctxWith(lu)).groups.listUsers("g1", AUTH);
    expect(lu).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: "/iam/acme/groups/g1/users" }),
    );

    const a = vi.fn().mockResolvedValue({ id: "as1" });
    await new IamService(ctxWith(a)).groups.addUser("g1", {} as never, AUTH);
    expect(a).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST", path: "/iam/acme/groups/g1/users" }),
    );

    const uu = vi.fn().mockResolvedValue({ id: "as1" });
    await new IamService(ctxWith(uu)).groups.updateUser("g1", "employee", "u1", {} as never, AUTH);
    expect(uu).toHaveBeenCalledWith(
      expect.objectContaining({ method: "PUT", path: "/iam/acme/groups/g1/users/employee/u1" }),
    );

    const ra = vi.fn().mockResolvedValue(undefined);
    await new IamService(ctxWith(ra)).groups.removeAllUsers("g1", AUTH);
    expect(ra).toHaveBeenCalledWith(
      expect.objectContaining({ method: "DELETE", path: "/iam/acme/groups/g1/users" }),
    );

    const lac = vi.fn().mockResolvedValue([{ id: "ac1" }]);
    await new IamService(ctxWith(lac)).groups.listAccessControls("g1", AUTH);
    expect(lac).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: "/iam/acme/groups/g1/access-controls" }),
    );
  });
});
