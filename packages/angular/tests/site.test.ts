import { describe, expect, it, vi } from "vitest";
import { TestBed } from "@angular/core/testing";
import { createMemoryStorage } from "@viu/emporix-sdk";
import { provideEmporix } from "../src/provide";
import { injectEmporixSite } from "../src/site";

function clientWith(
  context: Record<string, string> = {},
  overrides: { get?: () => Promise<unknown> } = {},
) {
  return {
    tenant: "acme",
    config: { credentials: { storefront: { context } } },
    sites: {
      get:
        overrides.get ??
        (async () => ({
          currency: "CHF",
          defaultLanguage: "de",
          languages: ["de", "fr"],
          homeBase: { address: { country: "CH" } },
        })),
    },
    setStorefrontContext: vi.fn(),
  } as never;
}

/** The derivation is a fire-and-forget promise; give it a turn. */
const derived = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("site resolution order", () => {
  it("prefers an explicit initialSiteCode", () => {
    const storage = createMemoryStorage();
    storage.setSiteCode("from-storage");
    TestBed.configureTestingModule({
      providers: [
        provideEmporix({
          client: clientWith({ siteCode: "from-config" }),
          storage,
          initialSiteCode: "explicit",
        }),
      ],
    });
    expect(TestBed.runInInjectionContext(() => injectEmporixSite()).siteCode()).toBe("explicit");
  });

  it("falls back to storage", () => {
    const storage = createMemoryStorage();
    storage.setSiteCode("from-storage");
    TestBed.configureTestingModule({
      providers: [provideEmporix({ client: clientWith({ siteCode: "from-config" }), storage })],
    });
    expect(TestBed.runInInjectionContext(() => injectEmporixSite()).siteCode()).toBe(
      "from-storage",
    );
  });

  it("falls back to the client's storefront context", () => {
    TestBed.configureTestingModule({
      providers: [
        provideEmporix({
          client: clientWith({ siteCode: "from-config" }),
          storage: createMemoryStorage(),
        }),
      ],
    });
    expect(TestBed.runInInjectionContext(() => injectEmporixSite()).siteCode()).toBe(
      "from-config",
    );
  });

  it("is null when nothing resolves", () => {
    TestBed.configureTestingModule({
      providers: [provideEmporix({ client: clientWith(), storage: createMemoryStorage() })],
    });
    expect(TestBed.runInInjectionContext(() => injectEmporixSite()).siteCode()).toBeNull();
  });

  it("applies the same order to language", () => {
    const storage = createMemoryStorage();
    storage.setLanguage("fr");
    TestBed.configureTestingModule({
      providers: [provideEmporix({ client: clientWith({ language: "it" }), storage })],
    });
    expect(TestBed.runInInjectionContext(() => injectEmporixSite()).language()).toBe("fr");
  });
});

describe("mount-time derivation from the site DTO", () => {
  it("fills currency, targetLocation and a default language", async () => {
    TestBed.configureTestingModule({
      providers: [
        provideEmporix({
          client: clientWith({ siteCode: "main" }),
          storage: createMemoryStorage(),
        }),
      ],
    });
    const site = TestBed.runInInjectionContext(() => injectEmporixSite());
    await derived();
    expect(site.currency()).toBe("CHF");
    expect(site.targetLocation()).toBe("CH");
    expect(site.language()).toBe("de");
  });

  it("does not override a currency already seeded from the client config", async () => {
    // The persisted or configured choice wins; derivation only fills nulls.
    TestBed.configureTestingModule({
      providers: [
        provideEmporix({
          client: clientWith({ siteCode: "main", currency: "EUR" }),
          storage: createMemoryStorage(),
        }),
      ],
    });
    const site = TestBed.runInInjectionContext(() => injectEmporixSite());
    await derived();
    expect(site.currency()).toBe("EUR");
  });

  it("stays silent when the site fetch fails", async () => {
    TestBed.configureTestingModule({
      providers: [
        provideEmporix({
          client: clientWith({ siteCode: "main" }, { get: () => Promise.reject(new Error("502")) }),
          storage: createMemoryStorage(),
        }),
      ],
    });
    const site = TestBed.runInInjectionContext(() => injectEmporixSite());
    await derived();
    // Best-effort, exactly like React: a failed derivation leaves nulls rather
    // than surfacing an error the user cannot act on. switchError is reserved
    // for user-initiated switches.
    expect(site.currency()).toBeNull();
    expect(site.switchError()).toBeNull();
  });

  it("does not fetch at all when no site resolved", async () => {
    const client = clientWith() as unknown as { sites: { get: () => Promise<unknown> } };
    const spy = vi.spyOn(client.sites, "get");
    TestBed.configureTestingModule({
      providers: [provideEmporix({ client: client as never, storage: createMemoryStorage() })],
    });
    TestBed.runInInjectionContext(() => injectEmporixSite());
    await derived();
    expect(spy).not.toHaveBeenCalled();
  });

  it("pushes the resolved language to the SDK so the first reads carry it", () => {
    const client = clientWith({ language: "fr" }) as unknown as {
      setStorefrontContext: ReturnType<typeof vi.fn>;
    };
    TestBed.configureTestingModule({
      providers: [provideEmporix({ client: client as never, storage: createMemoryStorage() })],
    });
    TestBed.runInInjectionContext(() => injectEmporixSite());
    // Signal state alone never reaches the client — Accept-Language comes from
    // the SDK's storefront context, so it has to be pushed explicitly.
    expect(client.setStorefrontContext).toHaveBeenCalledWith({ language: "fr" });
  });
});
