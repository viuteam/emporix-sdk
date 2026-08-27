import { describe, expect, it } from "vitest";
import { TestBed } from "@angular/core/testing";
import { QueryClient } from "@tanstack/angular-query-experimental";
import { EmporixNotFoundError, type EmporixStorage } from "@viu/emporix-sdk";
import { provideEmporix, injectEmporix } from "../src/provide";

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
    const retry = qc.getQueryDefaults(["emporix"])?.retry as (c: number, e: unknown) => boolean;
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
    expect(qc.getQueryDefaults(["emporix"])?.staleTime).toBe(1);
  });
});

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
