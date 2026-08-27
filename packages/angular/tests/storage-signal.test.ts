import { describe, expect, it } from "vitest";
import { EnvironmentInjector, createEnvironmentInjector } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { createMemoryStorage } from "@viu/emporix-sdk";
import { cartIdSignal, customerTokenSignal, storageSignal } from "../src/storage-signal";

describe("customerTokenSignal", () => {
  it("starts at the stored value", () => {
    const storage = createMemoryStorage({ initial: "t1" });
    const token = TestBed.runInInjectionContext(() => customerTokenSignal(storage));
    expect(token()).toBe("t1");
  });

  it("tracks a login written after the signal was created", () => {
    // This is the bug class the React implementation was written to fix: a
    // one-shot read leaves every `enabled` gate frozen at page-load state, so a
    // customer who logs in keeps getting anonymous data until something
    // unrelated invalidates.
    const storage = createMemoryStorage();
    const token = TestBed.runInInjectionContext(() => customerTokenSignal(storage));
    expect(token()).toBeNull();
    storage.setCustomerToken("t2");
    expect(token()).toBe("t2");
  });

  it("tracks a logout", () => {
    const storage = createMemoryStorage({ initial: "t1" });
    const token = TestBed.runInInjectionContext(() => customerTokenSignal(storage));
    storage.setCustomerToken(null);
    expect(token()).toBeNull();
  });
});

describe("cartIdSignal", () => {
  it("tracks cart-id writes and ignores unrelated keys", () => {
    const storage = createMemoryStorage();
    const cartId = TestBed.runInInjectionContext(() => cartIdSignal(storage));
    expect(cartId()).toBeNull();
    storage.setCartId("c1");
    expect(cartId()).toBe("c1");

    // A siteCode write must not disturb the cart signal — every keyed signal
    // shares one subscribeAll feed, so the filter is load-bearing.
    storage.setSiteCode("main");
    expect(cartId()).toBe("c1");
  });
});

describe("storageSignal teardown", () => {
  it("stops updating once its injector is destroyed", () => {
    const storage = createMemoryStorage();
    const parent = TestBed.inject(EnvironmentInjector);
    const injector = createEnvironmentInjector([], parent);
    const language = storageSignal(storage, "language", (s) => s.getLanguage(), { injector });
    storage.setLanguage("de");
    expect(language()).toBe("de");

    // Destroying the injector must detach the storage listener. Without this, a
    // long-lived storage accumulates one listener per destroyed component and
    // leaks for the page's lifetime.
    injector.destroy();
    storage.setLanguage("fr");
    expect(language()).toBe("de");
  });

  it("accepts an explicit injector outside an injection context", () => {
    const storage = createMemoryStorage({ initial: "t1" });
    const injector = createEnvironmentInjector([], TestBed.inject(EnvironmentInjector));
    // No TestBed.runInInjectionContext wrapper here: this is the escape hatch
    // TanStack's own injectQuery offers, mirrored rather than reinvented.
    expect(customerTokenSignal(storage, { injector })()).toBe("t1");
  });

  it("throws a framework error when called with neither", () => {
    const storage = createMemoryStorage();
    expect(() => customerTokenSignal(storage)).toThrow();
  });
});
