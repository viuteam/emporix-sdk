import { describe, expect, it, vi } from "vitest";
import {
  EnvironmentInjector,
  InjectionToken,
  PLATFORM_ID,
  createEnvironmentInjector,
  inject,
  type EnvironmentProviders,
} from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { QueryClient } from "@tanstack/angular-query-experimental";
import {
  EmporixNotFoundError,
  createMemoryStorage,
  type AnonymousSessionStore,
  type EmporixStorage,
} from "@viu/emporix-sdk";
import { provideEmporix, injectEmporix } from "../src/provide";
import { injectEmporixSite } from "../src/site";
import { injectEmporixCompany } from "../src/company";

// Minimal stand-in: provideEmporix only stores the client, so a real
// EmporixClient would add a network surface for nothing.
const fakeClient = { tenant: "acme" } as never;

describe("provideEmporix", () => {
  it("makes the client and a fallback storage injectable", () => {
    TestBed.configureTestingModule({ providers: [provideEmporix({ client: fakeClient })] });
    const { client, storage } = TestBed.runInInjectionContext(() => injectEmporix());
    expect(client).toBe(fakeClient);
    // The fallback is a real memory storage, not null: every downstream
    // injectable reads storage unconditionally.
    expect(storage.getCustomerToken()).toBeNull();
  });

  it("uses a supplied storage instead of the fallback", () => {
    TestBed.configureTestingModule({
      providers: [provideEmporix({ client: fakeClient, storage: makeStorageWithToken("t1") })],
    });
    const { storage } = TestBed.runInInjectionContext(() => injectEmporix());
    expect(storage.getCustomerToken()).toBe("t1");
  });

  it("scopes the emporix query defaults without touching global defaults", () => {
    const qc = new QueryClient();
    TestBed.configureTestingModule({
      providers: [provideEmporix({ client: fakeClient, queryClient: qc })],
    });
    // Applied when the application injector is built, not when provideEmporix is called.
    TestBed.inject(QueryClient);
    const defaults = qc.getQueryDefaults(["emporix"]);
    expect(defaults?.staleTime).toBe(30_000);
    expect(defaults?.refetchOnWindowFocus).toBe(false);
    // A host application's own queries must be unaffected.
    expect(qc.getDefaultOptions().queries?.staleTime).toBeUndefined();
  });

  it("does not retry a 404 — the resource is gone and the retry is billed", () => {
    const qc = new QueryClient();
    TestBed.configureTestingModule({
      providers: [provideEmporix({ client: fakeClient, queryClient: qc })],
    });
    TestBed.inject(QueryClient);
    const retry =qc.getQueryDefaults(["emporix"])?.retry as (c: number, e: unknown) => boolean;
    expect(retry(0, new EmporixNotFoundError("gone", 404))).toBe(false);
    expect(retry(0, new Error("network"))).toBe(true);
    expect(retry(1, new Error("network"))).toBe(false);
  });

  it("lets a consumer's explicit emporix defaults win over ours", () => {
    const qc = new QueryClient();
    qc.setQueryDefaults(["emporix"], { staleTime: 1 });
    TestBed.configureTestingModule({
      providers: [provideEmporix({ client: fakeClient, queryClient: qc })],
    });
    TestBed.inject(QueryClient);
    expect(qc.getQueryDefaults(["emporix"])?.staleTime).toBe(1);
  });

  it("persists the guest session through the storage", () => {
    const attachAnonymousStore = vi.fn();
    const client = { tenant: "acme", tokenProvider: { attachAnonymousStore } } as never;
    const storage = createMemoryStorage();
    TestBed.configureTestingModule({ providers: [provideEmporix({ client, storage })] });
    TestBed.runInInjectionContext(() => injectEmporix());

    expect(attachAnonymousStore).toHaveBeenCalledTimes(1);
    const store = attachAnonymousStore.mock.calls[0]![0] as AnonymousSessionStore;
    store.write({ sessionId: "s1", refreshToken: "rt-1" });
    expect(storage.getAnonymousSession()?.sessionId).toBe("s1");
    expect(store.read()?.sessionId).toBe("s1");
  });
});

// Under server-side rendering every request bootstraps its own application from
// the same module-level `appConfig`, so one `provideEmporix(...)` result serves
// many application injectors. Anything it shares, one visitor sees of another.
describe("provideEmporix per application injector", () => {
  const twoApps = (providers: EnvironmentProviders, platform = "browser") => {
    const parent = TestBed.inject(EnvironmentInjector);
    const app = () => {
      const injector = createEnvironmentInjector(
        [{ provide: PLATFORM_ID, useValue: platform }, providers],
        parent,
      );
      return {
        ...injector.runInContext(() => injectEmporix()),
        qc: injector.get(QueryClient),
        site: injector.runInContext(() => injectEmporixSite()),
        company: injector.runInContext(() => injectEmporixCompany()),
      };
    };
    return [app(), app()] as const;
  };

  it("gives each application its own storage, cache, site and company state", () => {
    const [a, b] = twoApps(provideEmporix({ client: fakeClient }));
    expect(a.storage).not.toBe(b.storage);
    expect(a.qc).not.toBe(b.qc);
    expect(a.site).not.toBe(b.site);
    expect(a.company).not.toBe(b.company);

    a.storage.setCustomerToken("token-A");
    expect(b.storage.getCustomerToken()).toBeNull();
  });

  it("runs client, storage and queryClient factories per application, in its injection context", () => {
    const REQ = new InjectionToken<string>("REQ");
    let n = 0;
    const providers = provideEmporix({
      client: () => ({ tenant: `t${++n}` }) as never,
      storage: () => createMemoryStorage({ initial: inject(REQ) }),
      queryClient: () => new QueryClient(),
    });
    const parent = TestBed.inject(EnvironmentInjector);
    const app = (req: string) =>
      createEnvironmentInjector([{ provide: REQ, useValue: req }, providers], parent).runInContext(
        () => injectEmporix(),
      );

    const a = app("token-A");
    const b = app("token-B");
    expect(a.client.tenant).toBe("t1");
    expect(b.client.tenant).toBe("t2");
    expect(a.storage.getCustomerToken()).toBe("token-A");
    expect(b.storage.getCustomerToken()).toBe("token-B");
  });

  it.each([
    ["client", () => provideEmporix({ client: fakeClient })],
    ["storage", () => provideEmporix({ client: () => fakeClient2(), storage: createMemoryStorage() })],
    ["queryClient", () => provideEmporix({ client: () => fakeClient2(), queryClient: new QueryClient() })],
  ])("refuses, on the server, a %s instance that another application already uses", (name, make) => {
    expect(() => twoApps(make(), "server")).toThrow(
      new RegExp(`this ${name} already serves another application`),
    );
  });

  it("refuses, on the server, a factory that hands out one shared instance", () => {
    const shared = createMemoryStorage();
    const providers = provideEmporix({ client: () => fakeClient2(), storage: () => shared });
    expect(() => twoApps(providers, "server")).toThrow(/this storage already serves another application/);
  });

  it("accepts factories on the server", () => {
    const providers = provideEmporix({ client: () => fakeClient2(), storage: () => createMemoryStorage() });
    const [a, b] = twoApps(providers, "server");
    expect(a.client).not.toBe(b.client);
  });
});

/** A fresh stand-in per call, for the server cases where an instance may serve one application only. */
const fakeClient2 = () => ({ tenant: "acme" }) as never;

function makeStorageWithToken(token: string): EmporixStorage {
  // Local helper rather than a shared fixture: only this file needs it, and
  // Task 3 replaces createMemoryStorage's import path anyway.
  const s: { token: string | null } = { token };
  return {
    getCustomerToken: () => s.token,
    setCustomerToken: (t) => {
      s.token = t;
    },
    getCartId: () => null,
    setCartId: () => {},
    getAnonymousSession: () => null,
    setAnonymousSession: () => {},
    getSiteCode: () => null,
    setSiteCode: () => {},
    getLanguage: () => null,
    setLanguage: () => {},
    getActiveLegalEntityId: () => null,
    setActiveLegalEntityId: () => {},
    getRefreshToken: () => null,
    setRefreshToken: () => {},
  };
}
