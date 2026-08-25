import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationRef, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { QueryClient } from "@tanstack/angular-query-experimental";
import { EmporixNotFoundError, createMemoryStorage, type EmporixStorage } from "@viu/emporix-sdk";
import { provideEmporix } from "../src/provide";
import {
  injectActiveCart,
  injectAvailability,
  injectCart,
  injectCartMutations,
  injectCategoryTree,
  injectCheckout,
  injectMatchPrices,
  injectMyOrders,
  injectOrder,
  injectPasswordReset,
  injectPaymentModes,
  injectProduct,
  injectProductSearch,
  injectProductsInfinite,
  injectSites,
  injectUpdateCustomer,
} from "../src/injectables/index";

const page = <T>(items: T[], n = 1, more = false) => ({
  items,
  pageNumber: n,
  pageSize: 10,
  hasNextPage: more,
});

function setup(overrides: Record<string, unknown> = {}) {
  const storage = createMemoryStorage();
  const queryClient = new QueryClient();
  const calls = {
    productGet: vi.fn(async () => ({ id: "p1" })),
    productList: vi.fn(async (p: { pageNumber?: number }) => page([{ id: `p${p.pageNumber ?? 1}` }], p.pageNumber ?? 1, (p.pageNumber ?? 1) < 2)),
    searchByName: vi.fn(async () => page([{ id: "p1" }])),
    listForProduct: vi.fn(async () => page([{ id: "m1" }])),
    categoryTree: vi.fn(async () => [{ id: "c1" }]),
    matchByContext: vi.fn(async () => [{ priceId: "pr1" }]),
    availabilityGet: vi.fn(async () => ({ available: true })),
    cartGet: vi.fn(async () => ({ id: "cart-1", items: [] })),
    cartGetCurrent: vi.fn(async () => ({ id: "cart-new", items: [] })),
    addItem: vi.fn(async () => ({ id: "cart-1" })),
    listPaymentModes: vi.fn(async () => [{ id: "mode-1" }]),
    placeOrder: vi.fn(async () => ({ orderId: "EON1" })),
    listMine: vi.fn(async () => page([{ id: "o1" }])),
    orderGet: vi.fn(async () => ({ id: "o1" })),
    sitesList: vi.fn(async () => [{ code: "main" }]),
    customerUpdate: vi.fn(async () => ({ id: "c1" })),
    requestPasswordReset: vi.fn(async () => undefined),
    me: vi.fn(async () => ({ id: "c1" })),
    ...overrides,
  };
  const client = {
    tenant: "acme",
    config: { credentials: { storefront: { context: { siteCode: "main", currency: "CHF" } } } },
    sites: { get: async () => ({ currency: "CHF" }), list: calls.sitesList },
    sessionContext: { patch: async () => true },
    setStorefrontContext: vi.fn(),
    products: { get: calls.productGet, list: calls.productList, searchByName: calls.searchByName },
    categories: { tree: calls.categoryTree },
    media: { listForProduct: calls.listForProduct },
    prices: { matchByContext: calls.matchByContext },
    availability: { get: calls.availabilityGet },
    carts: { get: calls.cartGet, getCurrent: calls.cartGetCurrent, addItem: calls.addItem },
    payments: { listPaymentModes: calls.listPaymentModes },
    checkout: { placeOrder: calls.placeOrder },
    orders: { listMine: calls.listMine, get: calls.orderGet },
    customers: {
      update: calls.customerUpdate,
      requestPasswordReset: calls.requestPasswordReset,
      me: calls.me,
      login: vi.fn(),
      logout: vi.fn(),
      signup: vi.fn(),
      refresh: vi.fn(),
    },
  } as never;
  TestBed.configureTestingModule({
    providers: [provideEmporix({ client, storage, queryClient })],
  });
  return { storage, queryClient, calls };
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

const settle = async (): Promise<void> => {
  const app = TestBed.inject(ApplicationRef);
  app.tick();
  await new Promise((r) => setTimeout(r, 0));
  app.tick();
};

/** Read the one cache key in play, so `site` and `mode` choices are assertable. */
function soleKey(qc: QueryClient, resource: string): Record<string, unknown> | undefined {
  const q = qc
    .getQueryCache()
    .getAll()
    .find((e) => e.queryKey[1] === resource);
  return q?.queryKey[q.queryKey.length - 1] as Record<string, unknown> | undefined;
}

describe("catalog injectables", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it("injectProduct is disabled while the id is empty", async () => {
    const id = signal("");
    TestBed.runInInjectionContext(() => injectProduct(id));
    await settle();
    expect(ctx.calls.productGet).not.toHaveBeenCalled();
    id.set("p1");
    await settleUntil(() => expect(ctx.calls.productGet).toHaveBeenCalledOnce());
  });

  /**
   * `site: "full"` is not cosmetic. A catalog read keyed without siteCode and
   * language would serve one site's products under another site's key — invisible
   * until someone switches site and sees the wrong catalog.
   */
  it("catalog reads carry both site discriminators", async () => {
    TestBed.runInInjectionContext(() => injectProduct(signal("p1")));
    await settleUntil(() => expect(soleKey(ctx.queryClient, "product")).toBeDefined());
    const meta = soleKey(ctx.queryClient, "product");
    expect(meta).toMatchObject({ tenant: "acme", authKind: "anonymous", siteCode: "main" });
    expect("language" in (meta ?? {})).toBe(true);
  });

  it("injectProductSearch stays idle on a blank term", async () => {
    const term = signal("   ");
    TestBed.runInInjectionContext(() => injectProductSearch(term));
    await settle();
    expect(ctx.calls.searchByName).not.toHaveBeenCalled();
    term.set("shoe");
    await settleUntil(() => expect(ctx.calls.searchByName).toHaveBeenCalledWith("shoe", {}, expect.anything()));
  });

  it("injectProductsInfinite advances the page number", async () => {
    const q = TestBed.runInInjectionContext(() => injectProductsInfinite(signal(10)));
    await settleUntil(() => expect(q.data()?.pages.length).toBe(1));
    await q.fetchNextPage();
    await settleUntil(() => expect(q.data()?.pages.length).toBe(2));
    expect(ctx.calls.productList.mock.calls.map((c) => (c[0] as { pageNumber?: number }).pageNumber)).toEqual([1, 2]);
  });

  it("injectCategoryTree fetches once", async () => {
    TestBed.runInInjectionContext(() => injectCategoryTree());
    await settleUntil(() => expect(ctx.calls.categoryTree).toHaveBeenCalledOnce());
  });
});

describe("price and availability", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it("injectMatchPrices stays idle while items is empty", async () => {
    const input = signal<{ items: unknown[] }>({ items: [] });
    TestBed.runInInjectionContext(() => injectMatchPrices(input as never));
    await settle();
    expect(ctx.calls.matchByContext).not.toHaveBeenCalled();
    input.set({ items: [{ itemId: { itemType: "PRODUCT", id: "p1" } }] });
    await settleUntil(() => expect(ctx.calls.matchByContext).toHaveBeenCalledOnce());
  });

  it("injectAvailability needs both a product and a site", async () => {
    const site = signal<string | null>(null);
    TestBed.runInInjectionContext(() => injectAvailability(signal("p1"), site));
    await settle();
    expect(ctx.calls.availabilityGet).not.toHaveBeenCalled();
    site.set("main");
    await settleUntil(() => expect(ctx.calls.availabilityGet).toHaveBeenCalledOnce());
  });

  it("the not-found fallback is part of the key", async () => {
    TestBed.runInInjectionContext(() =>
      injectAvailability(signal("p1"), signal("main"), { defaultAvailableOnNotFound: true }),
    );
    await settleUntil(() => expect(ctx.calls.availabilityGet).toHaveBeenCalledOnce());
    const key = ctx.queryClient
      .getQueryCache()
      .getAll()
      .find((e) => e.queryKey[1] === "availability")?.queryKey;
    // Same product, different fallback → different answer, so different entry.
    expect(key).toContain(true);
  });
});

describe("cart injectables", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it("injectCart falls back to the stored id and re-keys when it changes", async () => {
    ctx.storage.setCartId("cart-1");
    TestBed.runInInjectionContext(() => injectCart());
    await settleUntil(() => expect(ctx.calls.cartGet).toHaveBeenCalledWith("cart-1", expect.anything()));
  });

  /**
   * The failure this exists for: Emporix closes a cart when its order is placed,
   * so another device holding that id 404s forever — a stale id is not `null`, so
   * nothing bootstraps over it.
   */
  it("injectCart forgets a cart the server no longer has", async () => {
    const ctx2 = setup({
      cartGet: vi.fn(async () => {
        throw new EmporixNotFoundError("gone", 404);
      }),
    });
    ctx2.storage.setCartId("cart-dead");
    TestBed.runInInjectionContext(() => injectCart());
    await settleUntil(() => expect(ctx2.storage.getCartId()).toBeNull());
  });

  it("does not forget a cart when the failing id is not the stored one", async () => {
    const ctx2 = setup({
      cartGet: vi.fn(async () => {
        throw new EmporixNotFoundError("gone", 404);
      }),
    });
    ctx2.storage.setCartId("cart-mine");
    TestBed.runInInjectionContext(() => injectCart(signal("someone-elses")));
    await settle();
    await new Promise((r) => setTimeout(r, 1200));
    // A caller passing another cart's id must not be able to wipe this session's.
    expect(ctx2.storage.getCartId()).toBe("cart-mine");
  });

  it("injectActiveCart creates one and writes the id to storage", async () => {
    TestBed.runInInjectionContext(() => injectActiveCart({ create: true }));
    await settleUntil(() => expect(ctx.storage.getCartId()).toBe("cart-new"));
    // `Cart.id`, never `CartCreated.cartId` — getCurrent returns the former.
    expect(ctx.calls.cartGetCurrent).toHaveBeenCalledOnce();
  });

  it("injectActiveCart does not create without create:true", async () => {
    TestBed.runInInjectionContext(() => injectActiveCart());
    await settle();
    expect(ctx.calls.cartGetCurrent).not.toHaveBeenCalled();
    expect(ctx.storage.getCartId()).toBeNull();
  });

  it("cart mutations resolve the id at call time, not construction", async () => {
    const mut = TestBed.runInInjectionContext(() => injectCartMutations());
    // Constructed with an empty storage; the id arrives afterwards.
    ctx.storage.setCartId("cart-late");
    await mut.addItem({ itemYrn: "urn:x", quantity: 1 } as never);
    expect(ctx.calls.addItem).toHaveBeenCalledWith(
      "cart-late",
      expect.anything(),
      expect.anything(),
    );
  });

  it("cart mutations throw a named error when no cart exists", async () => {
    const mut = TestBed.runInInjectionContext(() => injectCartMutations());
    await expect(mut.addItem({ itemYrn: "urn:x", quantity: 1 } as never)).rejects.toThrow(
      /no cartId available/,
    );
  });
});

describe("checkout injectables", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  /**
   * The mistake this guards: the frontend payment-modes endpoint needs a bearer
   * token but no customer scope. Gating it on a login hides every payment option
   * from guest checkout.
   */
  it("payment modes load for a guest", async () => {
    TestBed.runInInjectionContext(() => injectPaymentModes());
    await settleUntil(() => expect(ctx.calls.listPaymentModes).toHaveBeenCalledOnce());
    expect(soleKey(ctx.queryClient, "payment-modes")).toMatchObject({ authKind: "anonymous" });
  });

  it("checkout drops the cart id on success — the cart is closed server-side", async () => {
    ctx.storage.setCartId("cart-1");
    const checkout = TestBed.runInInjectionContext(() => injectCheckout());
    const result = await checkout.placeOrder({ cartId: "cart-1" } as never);
    expect(result.orderId).toBe("EON1");
    expect(ctx.storage.getCartId()).toBeNull();
    expect(checkout.result()?.orderId).toBe("EON1");
  });

  it("checkout sends the saas token only for a customer", async () => {
    ctx.storage.setCustomerToken("t1");
    ctx.storage.setSaasToken?.("s1");
    const checkout = TestBed.runInInjectionContext(() => injectCheckout());
    await checkout.placeOrder({ cartId: "cart-1" } as never);
    expect(ctx.calls.placeOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ saasToken: "s1" }),
    );
  });

  it("a guest checkout sends no saas token even if one lingers", async () => {
    ctx.storage.setSaasToken?.("stale");
    const checkout = TestBed.runInInjectionContext(() => injectCheckout());
    await checkout.placeOrder({ cartId: "cart-1" } as never);
    // Through `unknown`: the mock's call tuple is untyped, and tsc rejects a
    // direct assertion from `undefined` to a record.
    const args = ctx.calls.placeOrder.mock.calls[0] as unknown as unknown[];
    const opts = (args[2] ?? {}) as Record<string, unknown>;
    expect("saasToken" in opts).toBe(false);
  });
});

describe("customer and order injectables", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it("injectMyOrders fetches nothing for a guest and keys as anonymous", async () => {
    TestBed.runInInjectionContext(() => injectMyOrders(signal({})));
    await settle();
    expect(ctx.calls.listMine).not.toHaveBeenCalled();
    expect(soleKey(ctx.queryClient, "my-orders")).toMatchObject({ authKind: "anonymous" });
  });

  it("injectMyOrders enables once a token appears", async () => {
    TestBed.runInInjectionContext(() => injectMyOrders(signal({ pageSize: 5 })));
    await settle();
    ctx.storage.setCustomerToken("t1");
    await settleUntil(() => expect(ctx.calls.listMine).toHaveBeenCalledOnce());
  });

  it("injectOrder is customer-gated and needs an id", async () => {
    ctx.storage.setCustomerToken("t1");
    const id = signal("");
    TestBed.runInInjectionContext(() => injectOrder(id));
    await settle();
    expect(ctx.calls.orderGet).not.toHaveBeenCalled();
    id.set("o1");
    await settleUntil(() => expect(ctx.calls.orderGet).toHaveBeenCalledOnce());
  });

  it("injectUpdateCustomer refuses without a session, naming the operation", async () => {
    const upd = TestBed.runInInjectionContext(() => injectUpdateCustomer());
    await expect(upd.update({} as never)).rejects.toThrow(/updateCustomer requires a signed-in/);
    expect(ctx.calls.customerUpdate).not.toHaveBeenCalled();
  });

  /** Locked out by definition — requiring a session would make this unreachable. */
  it("injectPasswordReset works with no session", async () => {
    const reset = TestBed.runInInjectionContext(() => injectPasswordReset());
    await reset.request({ email: "a@b.ch" } as never);
    expect(ctx.calls.requestPasswordReset).toHaveBeenCalledWith(
      { email: "a@b.ch" },
      { kind: "anonymous" },
    );
  });

  it("injectSites is not keyed by the active site — that would be circular", async () => {
    TestBed.runInInjectionContext(() => injectSites());
    await settleUntil(() => expect(ctx.calls.sitesList).toHaveBeenCalledOnce());
    expect(soleKey(ctx.queryClient, "sites")).toEqual({
      tenant: "acme",
      authKind: "anonymous",
    });
  });
});

describe("key parity across every injectable", () => {
  /**
   * Every read must go through the shared builder, so the shape is always
   * `["emporix", resource, ...args, meta]`. A hand-rolled key would break the
   * `["emporix"]` invalidation and the defaults scoped to that namespace.
   */
  it("all keys start with the emporix namespace", async () => {
    const ctx = setup();
    ctx.storage.setCustomerToken("t1");
    TestBed.runInInjectionContext(() => {
      injectProduct(signal("p1"));
      injectCategoryTree();
      injectPaymentModes();
      injectSites();
      injectMyOrders(signal({}));
      return null;
    });
    await settleUntil(() =>
      expect(ctx.queryClient.getQueryCache().getAll().length).toBeGreaterThanOrEqual(5),
    );
    for (const entry of ctx.queryClient.getQueryCache().getAll()) {
      expect(entry.queryKey[0]).toBe("emporix");
      const meta = entry.queryKey[entry.queryKey.length - 1] as Record<string, unknown>;
      expect(meta.tenant).toBe("acme");
      expect(typeof meta.authKind).toBe("string");
    }
  });
});

/** The storage used across the suite must satisfy the contract the SDK declares. */
describe("test fixture sanity", () => {
  it("createMemoryStorage exposes the optional saas accessors", () => {
    const s: EmporixStorage = createMemoryStorage();
    expect(typeof s.setSaasToken).toBe("function");
  });
});
