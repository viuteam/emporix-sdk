import { describe, expect, it, vi } from "vitest";
import { TestBed } from "@angular/core/testing";
import { QueryClient } from "@tanstack/angular-query-experimental";
import { createMemoryStorage } from "@viu/emporix-sdk";
import { provideEmporix } from "../src/provide";
import { injectEmporixSite } from "../src/site";
import { injectEmporixSiteSwitch } from "../src/site-switch";

function setup(overrides: { patch?: () => Promise<unknown> } = {}) {
  const storage = createMemoryStorage();
  const queryClient = new QueryClient();
  const setStorefrontContext = vi.fn();
  const patch = vi.fn(overrides.patch ?? (async () => true));
  const client = {
    tenant: "acme",
    config: { credentials: { storefront: { context: { siteCode: "main" } } } },
    sites: {
      get: async () => ({
        currency: "CHF",
        defaultLanguage: "de",
        languages: ["de", "fr"],
        homeBase: { address: { country: "CH" } },
      }),
    },
    sessionContext: { patch },
    setStorefrontContext,
  } as never;
  TestBed.configureTestingModule({
    providers: [provideEmporix({ client, storage, queryClient })],
  });
  const ctx = TestBed.runInInjectionContext(() => ({
    site: injectEmporixSite(),
    switcher: injectEmporixSiteSwitch(),
  }));
  return { ...ctx, storage, queryClient, patch, setStorefrontContext };
}

describe("setSite", () => {
  it("flips local state and storage immediately, before any server work", async () => {
    const { site, switcher, storage } = setup();
    const pending = switcher.setSite("other");
    // Optimistic: asserted before the await, which is the whole point.
    expect(site.siteCode()).toBe("other");
    expect(storage.getSiteCode()).toBe("other");
    await pending;
  });

  it("drops the cart id — carts are site-bound", async () => {
    const { switcher, storage } = setup();
    storage.setCartId("c1");
    await switcher.setSite("other");
    expect(storage.getCartId()).toBeNull();
  });

  it("derives currency and targetLocation, then patches the session context", async () => {
    const { site, switcher, patch } = setup();
    await switcher.setSite("other");
    expect(site.currency()).toBe("CHF");
    expect(site.targetLocation()).toBe("CH");
    expect(patch).toHaveBeenCalledWith(
      expect.objectContaining({ siteCode: "other", currency: "CHF", targetLocation: "CH" }),
      expect.anything(),
    );
  });

  it("clears currency and target for a null site without server work", async () => {
    // Also the regression test for a race this caught: `setup()` resolves a
    // siteCode from the client config, so createSiteState has a site-DTO fetch
    // in flight. It used to land after this unbind and refill the currency,
    // because it only checked `currency() === null`. It now bails when the
    // active site changed while the request was in flight.
    const { site, switcher, patch } = setup();
    await switcher.setSite(null);
    expect(site.siteCode()).toBeNull();
    expect(site.currency()).toBeNull();
    expect(patch).not.toHaveBeenCalled();
  });

  it("surfaces a patch failure in switchError WITHOUT rolling back", async () => {
    const { site, switcher } = setup({
      patch: async () => {
        throw new Error("patch failed");
      },
    });
    await switcher.setSite("other");
    expect(site.switchError()?.message).toBe("patch failed");
    // No rollback: the cache is already invalidated and the UI already moved.
    // Reverting here would show the user a site they did not choose.
    expect(site.siteCode()).toBe("other");
    expect(site.isSwitching()).toBe(false);
  });
});

describe("setCurrency", () => {
  it("re-binds the anonymous price context so guest pricing changes pre-cart", async () => {
    const { switcher, setStorefrontContext } = setup();
    await switcher.setCurrency("EUR");
    expect(setStorefrontContext).toHaveBeenCalledWith({ currency: "EUR" });
  });

  it("drops the currency-bound guest cart", async () => {
    const { switcher, storage } = setup();
    storage.setCartId("c1");
    await switcher.setCurrency("EUR");
    expect(storage.getCartId()).toBeNull();
  });
});

describe("setLanguage", () => {
  it("persists, sets the Accept-Language source, and does NOT drop the cart", async () => {
    const { site, switcher, storage, setStorefrontContext } = setup();
    storage.setCartId("c1");
    await switcher.setLanguage("fr");
    expect(site.language()).toBe("fr");
    expect(storage.getLanguage()).toBe("fr");
    expect(setStorefrontContext).toHaveBeenCalledWith({ language: "fr" });
    // Language does not affect pricing, so the cart survives.
    expect(storage.getCartId()).toBe("c1");
  });
});

describe("cache invalidation", () => {
  it("invalidates the whole emporix namespace on a switch", async () => {
    const { switcher, queryClient } = setup();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await switcher.setLanguage("fr");
    expect(spy).toHaveBeenCalledWith({ queryKey: ["emporix"] });
  });
});
