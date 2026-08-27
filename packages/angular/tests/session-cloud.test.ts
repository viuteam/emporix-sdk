import { describe, expect, it, vi } from "vitest";
import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { QueryClient } from "@tanstack/angular-query-experimental";
import { createMemoryStorage, type EmporixStorage } from "@viu/emporix-sdk";
import { provideEmporix } from "../src/provide";
import { injectSessionAttributeMutations } from "../src/injectables/session-attributes";
import { injectCloudFunction, injectCloudFunctions } from "../src/injectables/cloud-functions";
import { injectApprovalMutations } from "../src/injectables/approvals";

type Mock = ReturnType<typeof vi.fn>;
interface Calls {
  addAttribute: Mock;
  removeAttribute: Mock;
  patch: Mock;
  invoke: Mock;
  createApproval: Mock;
}

let storage: EmporixStorage;
let qc: QueryClient;
let calls: Calls;

function boot(signedIn: boolean): void {
  storage = createMemoryStorage();
  if (signedIn) storage.setCustomerToken("t1");
  qc = new QueryClient();
  calls = {
    addAttribute: vi.fn(async () => undefined),
    removeAttribute: vi.fn(async () => undefined),
    patch: vi.fn(async () => true),
    invoke: vi.fn(async () => ({ ok: true })),
    createApproval: vi.fn(async () => ({ id: "ap1" })),
  } as unknown as Calls;
  const client = {
    tenant: "acme",
    config: {},
    sessionContext: {
      addAttribute: calls.addAttribute,
      removeAttribute: calls.removeAttribute,
      patch: calls.patch,
    },
    cloudFunctions: { invoke: calls.invoke },
    approvals: { createApproval: calls.createApproval },
  } as never;
  TestBed.configureTestingModule({
    providers: [provideEmporix({ client, storage, queryClient: qc })],
  });
}

describe("injectSessionAttributeMutations", () => {
  /**
   * The endpoint is `/session-context/{tenant}/me/context/attributes`, so `me`
   * resolves to whoever the bearer is. Writing anonymously while signed in puts
   * the attribute on a different session than the shopper is using — and this
   * package already writes to the same service from `injectEmporixSiteSwitch`
   * with the live context, so anonymous here would split site, currency and
   * attributes across two session contexts.
   *
   * React forces `auth.anonymous()` in `useAddSessionAttribute` while its own
   * site context passes the live context to `patch`. This asserts the invariant
   * React breaks.
   */
  it("writes with the customer context when signed in", async () => {
    boot(true);
    const m = TestBed.runInInjectionContext(() => injectSessionAttributeMutations());
    await m.add({ name: "channel", value: "web" } as never);
    expect(calls.addAttribute).toHaveBeenCalledWith(
      { name: "channel", value: "web" },
      expect.objectContaining({ kind: "customer" }),
    );
  });

  it("writes anonymously for a guest, without throwing", async () => {
    boot(false);
    const m = TestBed.runInInjectionContext(() => injectSessionAttributeMutations());
    await m.remove("channel");
    expect(calls.removeAttribute).toHaveBeenCalledWith(
      "channel",
      expect.objectContaining({ kind: "anonymous" }),
    );
  });

  it("uses the same identity the site switch writes with", async () => {
    boot(true);
    const m = TestBed.runInInjectionContext(() => injectSessionAttributeMutations());
    await m.add({ name: "a", value: "1" } as never);
    const attrCtx = (calls.addAttribute.mock.calls[0] as [unknown, { kind: string }])[1];
    // Same resolution the switch uses for `sessionContext.patch`: customer when a
    // token is stored. If these ever diverge, the two write to different sessions.
    expect(attrCtx.kind).toBe("customer");
  });

  it("invalidates the session context and nothing else", async () => {
    boot(true);
    const spy = vi.spyOn(qc, "invalidateQueries");
    const m = TestBed.runInInjectionContext(() => injectSessionAttributeMutations());
    await m.add({ name: "a", value: "1" } as never);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["emporix", "session-context"] });
  });
});

describe("injectCloudFunctions", () => {
  /**
   * A cloud function's effects are opaque to this package. Invalidating
   * `["emporix"]` wholesale would refetch a storefront's entire cache on every
   * call, and Emporix bills per request — so the honest answer is to invalidate
   * nothing and let the call site invalidate what it knows changed.
   */
  it("invalidates nothing", async () => {
    boot(true);
    const spy = vi.spyOn(qc, "invalidateQueries");
    const m = TestBed.runInInjectionContext(() => injectCloudFunctions());
    await expect(m.invoke({ functionId: "fn1" })).resolves.toEqual({ ok: true });
    expect(spy).not.toHaveBeenCalled();
  });

  it("forwards the options and the resolved context", async () => {
    boot(true);
    const m = TestBed.runInInjectionContext(() => injectCloudFunctions());
    await m.invoke({ functionId: "fn1", options: { method: "GET" } as never });
    expect(calls.invoke).toHaveBeenCalledWith(
      "fn1",
      { method: "GET" },
      expect.objectContaining({ kind: "customer" }),
    );
  });

  it("names the function in a failure so error() is actionable", async () => {
    boot(true);
    calls.invoke.mockImplementation(async () => {
      throw new Error("500");
    });
    const m = TestBed.runInInjectionContext(() => injectCloudFunctions());
    await expect(m.invoke({ functionId: "fn1" })).rejects.toThrow("500");
    expect(m.error()?.message).toBe("500");
  });
});

describe("injectApprovalMutations", () => {
  it("is customer-gated and spends no request for a guest", async () => {
    boot(false);
    const m = TestBed.runInInjectionContext(() => injectApprovalMutations());
    await expect(m.create({} as never)).rejects.toThrow(/requires a signed-in customer/);
    expect(calls.createApproval).not.toHaveBeenCalled();
  });

  it("passes a customer context, never the facade's service default", async () => {
    boot(true);
    const m = TestBed.runInInjectionContext(() => injectApprovalMutations());
    await m.create({ orderId: "EON1" } as never);
    expect(calls.createApproval).toHaveBeenCalledWith(
      { orderId: "EON1" },
      expect.objectContaining({ kind: "customer" }),
    );
  });
});

describe("injectCloudFunction as a read", () => {
  it("is disabled while the function id is empty", async () => {
    boot(true);
    TestBed.runInInjectionContext(() => injectCloudFunction(signal("")));
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.invoke).not.toHaveBeenCalled();
  });
});
