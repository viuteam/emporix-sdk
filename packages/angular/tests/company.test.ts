import { describe, expect, it, vi } from "vitest";
import { ApplicationRef } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { QueryClient } from "@tanstack/angular-query-experimental";
import { createMemoryStorage, type EmporixStorage } from "@viu/emporix-sdk";
import { provideEmporix } from "../src/provide";
import { injectEmporixCompany } from "../src/company";
import { injectCompanySwitch } from "../src/company-switch";

type Mock = ReturnType<typeof vi.fn>;

let storage: EmporixStorage;
let qc: QueryClient;
let listMine: Mock;
let refresh: Mock;

interface BootOpts {
  signedIn?: boolean;
  companies?: Array<{ id: string }>;
  refreshToken?: string | null;
  initialLegalEntityId?: string;
  refreshImpl?: Mock;
}

function boot(o: BootOpts = {}): void {
  storage = createMemoryStorage();
  if (o.signedIn !== false) storage.setCustomerToken("t1");
  if (o.refreshToken !== null) storage.setRefreshToken?.(o.refreshToken ?? "r1");
  qc = new QueryClient();
  listMine = vi.fn(async () => o.companies ?? []);
  refresh =
    o.refreshImpl ??
    vi.fn(async () => ({ customerToken: "t2", refreshToken: "r2", saasToken: null }));
  const client = {
    tenant: "acme",
    config: {},
    companies: { listMine },
    customers: { refresh, me: vi.fn(async () => ({ id: "c1" })) },
  } as never;
  TestBed.configureTestingModule({
    providers: [
      provideEmporix({
        client,
        storage,
        queryClient: qc,
        ...(o.initialLegalEntityId !== undefined
          ? { initialLegalEntityId: o.initialLegalEntityId }
          : {}),
      }),
    ],
  });
}

async function settleUntil(assertion: () => void): Promise<void> {
  await vi.waitFor(
    () => {
      TestBed.inject(ApplicationRef).tick();
      assertion();
    },
    { timeout: 5_000, interval: 25 },
  );
}

describe("injectEmporixCompany", () => {
  it("is b2c for a guest and lists nothing", async () => {
    boot({ signedIn: false });
    const c = TestBed.runInInjectionContext(() => injectEmporixCompany());
    await new Promise((r) => setTimeout(r, 0));
    expect(c.mode()).toBe("b2c");
    expect(c.activeCompany()).toBeNull();
    expect(listMine).not.toHaveBeenCalled();
  });

  /**
   * The state a storefront must not guess its way out of. Several companies and
   * none picked means «render a picker» — treating it as B2C shows one company's
   * prices to a buyer who belongs to another.
   */
  it("is unresolved with several companies and none picked", async () => {
    boot({ companies: [{ id: "le1" }, { id: "le2" }] });
    const c = TestBed.runInInjectionContext(() => injectEmporixCompany());
    await settleUntil(() => expect(c.myCompanies().length).toBe(2));
    expect(c.mode()).toBe("unresolved");
    expect(c.activeCompany()).toBeNull();
  });

  /** One company is not a choice — and the auto-pick must rescope the token, not just the signal. */
  it("auto-picks a single company and rescopes the token", async () => {
    boot({ companies: [{ id: "le1" }] });
    const c = TestBed.runInInjectionContext(() => injectEmporixCompany());
    await settleUntil(() => expect(c.activeCompany()?.id).toBe("le1"));
    expect(c.mode()).toBe("b2b");
    expect(refresh).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: "r1", legalEntityId: "le1" }),
    );
    expect(storage.getCustomerToken()).toBe("t2");
    expect(storage.getActiveLegalEntityId()).toBe("le1");
  });

  it("restores a persisted entity without rescoping", async () => {
    boot({ companies: [{ id: "le1" }, { id: "le2" }] });
    storage.setActiveLegalEntityId("le2");
    const s = TestBed.runInInjectionContext(() => injectCompanySwitch());
    await s.refetchMyCompanies();
    const c = TestBed.runInInjectionContext(() => injectEmporixCompany());
    expect(c.activeCompany()?.id).toBe("le2");
    expect(c.mode()).toBe("b2b");
    // Already scoped — re-refreshing the token would spend a call for nothing.
    expect(refresh).not.toHaveBeenCalled();
  });

  /**
   * A persisted id the customer is no longer assigned to must not stay active,
   * and must not survive to resurrect itself on the next reload.
   */
  it("drops a persisted entity the customer no longer belongs to", async () => {
    boot({ companies: [{ id: "le1" }, { id: "le2" }], initialLegalEntityId: "gone" });
    const c = TestBed.runInInjectionContext(() => injectEmporixCompany());
    await settleUntil(() => expect(c.myCompanies().length).toBe(2));
    expect(c.activeCompany()).toBeNull();
    expect(storage.getActiveLegalEntityId()).toBeNull();
    expect(c.mode()).toBe("unresolved");
  });

  it("reports a failed listing on status and error", async () => {
    boot();
    listMine.mockImplementation(async () => {
      throw new Error("403");
    });
    const s = TestBed.runInInjectionContext(() => injectCompanySwitch());
    await s.refetchMyCompanies();
    const c = TestBed.runInInjectionContext(() => injectEmporixCompany());
    expect(c.status()).toBe("error");
    expect((c.error() as Error).message).toBe("403");
  });
});

describe("injectCompanySwitch", () => {
  it("rescopes, drops the cart and persists the rotated refresh token", async () => {
    boot({ companies: [{ id: "le1" }, { id: "le2" }] });
    const c = TestBed.runInInjectionContext(() => injectEmporixCompany());
    await settleUntil(() => expect(c.myCompanies().length).toBe(2));
    storage.setCartId("cart-1");
    const s = TestBed.runInInjectionContext(() => injectCompanySwitch());

    await s.setActiveCompany("le2");

    expect(refresh).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: "r1", legalEntityId: "le2" }),
    );
    expect(storage.getCartId()).toBeNull();
    expect(storage.getRefreshToken?.()).toBe("r2");
    expect(c.activeCompany()?.id).toBe("le2");
    expect(s.isSwitching()).toBe(false);
  });

  it("refuses an id the customer is not assigned to, before rotating anything", async () => {
    boot({ companies: [{ id: "le1" }, { id: "le2" }] });
    const c = TestBed.runInInjectionContext(() => injectEmporixCompany());
    await settleUntil(() => expect(c.myCompanies().length).toBe(2));
    const before = refresh.mock.calls.length;
    const s = TestBed.runInInjectionContext(() => injectCompanySwitch());

    await s.setActiveCompany("someone-elses");

    expect(refresh.mock.calls.length).toBe(before);
    expect(String((s.switchError() as Error).message)).toContain("someone-elses");
    expect(c.status()).toBe("error");
  });

  it("falls back to local state only when no refresh token is stored", async () => {
    boot({ companies: [{ id: "le1" }, { id: "le2" }], refreshToken: null });
    const c = TestBed.runInInjectionContext(() => injectEmporixCompany());
    await settleUntil(() => expect(c.myCompanies().length).toBe(2));
    const s = TestBed.runInInjectionContext(() => injectCompanySwitch());

    await s.setActiveCompany("le2");

    expect(refresh).not.toHaveBeenCalled();
    expect(s.switchError()).toBeNull();
    expect(c.activeCompany()?.id).toBe("le2");
    expect(storage.getActiveLegalEntityId()).toBe("le2");
  });

  /**
   * The reason this is a queue and not a race guard. Two concurrent switches
   * both read the refresh token; Emporix may rotate it server-side, so the
   * second call would spend a token the first already consumed — a 401 at best,
   * a revoked session at worst.
   *
   * The assertion is on the *tokens sent*: the second refresh must carry what the
   * first one rotated to, which is only possible if it ran after it.
   */
  it("serializes concurrent switches so each reads the token the last one rotated to", async () => {
    let issued = 1;
    const sequential = vi.fn(async (input: { refreshToken: string }) => {
      // A real round trip, so an unserialized pair would overlap here.
      await new Promise((r) => setTimeout(r, 10));
      issued += 1;
      return {
        customerToken: `t${issued}`,
        refreshToken: `r${issued}`,
        saasToken: null,
        seen: input.refreshToken,
      };
    });
    boot({
      companies: [{ id: "le1" }, { id: "le2" }, { id: "le3" }],
      refreshImpl: sequential as never,
    });
    const c = TestBed.runInInjectionContext(() => injectEmporixCompany());
    await settleUntil(() => expect(c.myCompanies().length).toBe(3));
    const s = TestBed.runInInjectionContext(() => injectCompanySwitch());

    await Promise.all([s.setActiveCompany("le2"), s.setActiveCompany("le3")]);

    const sent = sequential.mock.calls.map((call) => (call[0] as { refreshToken: string }).refreshToken);
    expect(sent).toHaveLength(2);
    // Not the same token twice: the second switch read what the first wrote.
    expect(new Set(sent).size).toBe(2);
    expect(sent[1]).toBe(`r${2}`);
  });

  it("keeps the queue alive after a failed switch", async () => {
    const failing = vi
      .fn()
      .mockImplementationOnce(async () => {
        throw new Error("401");
      })
      .mockImplementation(async () => ({
        customerToken: "t9",
        refreshToken: "r9",
        saasToken: null,
      }));
    boot({ companies: [{ id: "le1" }, { id: "le2" }], refreshImpl: failing as never });
    const c = TestBed.runInInjectionContext(() => injectEmporixCompany());
    await settleUntil(() => expect(c.myCompanies().length).toBe(2));
    const s = TestBed.runInInjectionContext(() => injectCompanySwitch());

    await s.setActiveCompany("le2");
    expect((s.switchError() as Error).message).toBe("401");

    await s.setActiveCompany("le1");
    expect(s.switchError()).toBeNull();
    expect(c.activeCompany()?.id).toBe("le1");
  });

  it("a failed rescope leaves the cart alone", async () => {
    boot({
      companies: [{ id: "le1" }, { id: "le2" }],
      refreshImpl: vi.fn(async () => {
        throw new Error("401");
      }) as never,
    });
    const c = TestBed.runInInjectionContext(() => injectEmporixCompany());
    await settleUntil(() => expect(c.myCompanies().length).toBe(2));
    storage.setCartId("cart-1");
    const s = TestBed.runInInjectionContext(() => injectCompanySwitch());

    await s.setActiveCompany("le2");

    expect(storage.getCartId()).toBe("cart-1");
  });

  it("switching to null returns to b2c", async () => {
    boot({ companies: [{ id: "le1" }] });
    const c = TestBed.runInInjectionContext(() => injectEmporixCompany());
    await settleUntil(() => expect(c.activeCompany()?.id).toBe("le1"));
    const s = TestBed.runInInjectionContext(() => injectCompanySwitch());

    await s.setActiveCompany(null);

    expect(c.activeCompany()).toBeNull();
    expect(c.mode()).toBe("b2c");
    expect(storage.getActiveLegalEntityId()).toBeNull();
  });
});
