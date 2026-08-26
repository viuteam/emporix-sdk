import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationRef, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { QueryClient } from "@tanstack/angular-query-experimental";
import { createMemoryStorage, type EmporixStorage } from "@viu/emporix-sdk";
import { provideEmporix } from "../src/provide";
import * as I from "../src/injectables/index";

/**
 * Every injectable, called once.
 *
 * The area tests cover the interesting behaviour — gates, cache keys, the cart's
 * 404 handling. This covers the rest of the surface, which is exactly where a
 * cheap mistake hides: a typo'd `resource` string, a `site` field copied from the
 * wrong neighbour, an `enabled` gate that never opens. None of those show up until
 * a consumer hits them, and none of them are visible in a diff.
 *
 * Each row asserts two things: the facade method it is supposed to call was
 * called, and the key it produced starts with the `["emporix", resource]` shape
 * that `["emporix"]`-scoped invalidation and defaults depend on.
 */
const page = <T>(items: T[]) => ({ items, pageNumber: 1, pageSize: 10, hasNextPage: false });

function makeClient() {
  const fn = () => vi.fn(async () => ({}) as never);
  const listFn = () => vi.fn(async () => page([{ id: "x1" }]) as never);
  return {
    tenant: "acme",
    config: { credentials: { storefront: { context: { siteCode: "main", currency: "CHF" } } } },
    setStorefrontContext: vi.fn(),
    sessionContext: { patch: vi.fn(async () => true) },
    sites: { get: vi.fn(async () => ({ currency: "CHF" })), list: vi.fn(async () => [{ code: "main" }]) },
    products: {
      get: fn(),
      list: listFn(),
      getByCode: fn(),
      search: listFn(),
      searchByName: listFn(),
      searchByIds: vi.fn(async () => []),
      searchByCodes: vi.fn(async () => []),
      listVariantChildren: vi.fn(async () => []),
    },
    categories: {
      get: fn(),
      list: listFn(),
      tree: vi.fn(async () => []),
      productsIn: listFn(),
      parents: vi.fn(async () => []),
      childCategories: vi.fn(async () => []),
      subcategories: vi.fn(async () => []),
      search: listFn(),
      getTree: vi.fn(async () => ({ id: "c1", children: [] })),
    },
    media: { listForProduct: listFn() },
    prices: { matchByContext: vi.fn(async () => []), matchByContextChunked: vi.fn(async () => []) },
    availability: { get: fn(), getMany: vi.fn(async () => []) },
    carts: {
      get: vi.fn(async () => ({ id: "cart-1", items: [] })),
      getCurrent: vi.fn(async () => ({ id: "cart-1", items: [] })),
      listItems: vi.fn(async () => []),
      create: vi.fn(async () => ({ cartId: "cart-2" })),
      validate: vi.fn(async () => ({ valid: true })),
      addItem: fn(),
      updateItem: fn(),
      removeItem: fn(),
      clear: fn(),
      applyCoupon: fn(),
      removeCoupon: fn(),
      refresh: fn(),
      changeSite: fn(),
      changeCurrency: fn(),
      setShippingAddress: fn(),
      setBillingAddress: fn(),
    },
    payments: { listPaymentModes: vi.fn(async () => []), getMode: fn(), initialize: fn() },
    shipping: { listZones: vi.fn(async () => []) },
    checkout: { placeOrder: vi.fn(async () => ({ orderId: "EON1" })) },
    orders: { listMine: listFn(), get: fn(), cancel: fn(), transition: fn() },
    salesOrders: { get: fn(), update: fn() },
    companies: {
      listMine: vi.fn(async () => []),
      get: fn(),
      create: fn(),
      update: fn(),
      delete: fn(),
    },
    contacts: { listForCompany: vi.fn(async () => []), assign: fn(), update: fn(), unassign: fn() },
    locations: { listForCompany: vi.fn(async () => []), create: fn(), update: fn(), delete: fn() },
    customerGroups: {
      listForCompany: vi.fn(async () => []),
      addMember: fn(),
      removeMember: fn(),
    },
    approvals: {
      listApprovals: vi.fn(async () => ({ items: [] })),
      getApproval: fn(),
      createApproval: vi.fn(async () => ({ id: "ap1" })),
      updateApproval: fn(),
    },
    cloudFunctions: { invoke: fn() },
    segments: {
      list: vi.fn(async () => []),
      listItems: vi.fn(async () => []),
      listMyProducts: listFn(),
      listMyCategories: listFn(),
      getCategoryTree: vi.fn(async () => ({ children: [] })),
    },
    rewardPoints: {
      getMyPoints: vi.fn(async () => 0),
      getMySummary: fn(),
      listRedeemOptions: vi.fn(async () => []),
      redeemMyPoints: fn(),
    },
    returns: {
      listReturns: vi.fn(async () => []),
      getReturn: fn(),
      createReturn: vi.fn(async () => ({ id: "r1" })),
    },
    coupons: { validateCoupon: fn(), redeemCoupon: vi.fn(async () => ({ id: "red1" })) },
    shoppingLists: {
      list: vi.fn(async () => []),
      create: vi.fn(async () => ({ id: "l1" })),
      delete: fn(),
      addItem: fn(),
      removeItem: fn(),
      setItemQuantity: fn(),
    },
    customers: {
      me: vi.fn(async () => ({ id: "c1" })),
      update: fn(),
      addresses: {
        list: vi.fn(async () => []),
        get: fn(),
        add: fn(),
        update: fn(),
        remove: fn(),
        addTags: fn(),
        removeTags: fn(),
      },
      requestPasswordReset: fn(),
      confirmPasswordReset: fn(),
      login: vi.fn(),
      logout: vi.fn(),
      signup: vi.fn(),
      refresh: vi.fn(),
    },
  };
}

type Client = ReturnType<typeof makeClient>;

let client: Client;
let storage: EmporixStorage;
let qc: QueryClient;

function boot(signedIn: boolean): void {
  client = makeClient();
  storage = createMemoryStorage();
  if (signedIn) storage.setCustomerToken("t1");
  qc = new QueryClient();
  TestBed.configureTestingModule({
    providers: [provideEmporix({ client: client as never, storage, queryClient: qc })],
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

/** Assert the produced key is `["emporix", resource, …, meta]`. */
function expectKeyShape(resource: string): void {
  const entry = qc
    .getQueryCache()
    .getAll()
    .find((e) => e.queryKey[1] === resource);
  expect(entry, `no cache entry for resource "${resource}"`).toBeDefined();
  const key = entry?.queryKey ?? [];
  expect(key[0]).toBe("emporix");
  const meta = key[key.length - 1] as Record<string, unknown>;
  expect(meta.tenant).toBe("acme");
  expect(typeof meta.authKind).toBe("string");
}

/** Reads that work for a guest. */
const guestReads: Array<{
  name: string;
  resource: string;
  run: () => unknown;
  called: () => ReturnType<typeof vi.fn>;
}> = [
  { name: "injectProduct", resource: "product", run: () => I.injectProduct(signal("p1")), called: () => client.products.get },
  { name: "injectProducts", resource: "products", run: () => I.injectProducts(signal({ pageSize: 5 })), called: () => client.products.list },
  { name: "injectProductsInfinite", resource: "products-infinite", run: () => I.injectProductsInfinite(signal(5)), called: () => client.products.list },
  { name: "injectProductByCode", resource: "product-by-code", run: () => I.injectProductByCode(signal("code-1")), called: () => client.products.getByCode },
  { name: "injectProductNameSearch", resource: "product-name-search", run: () => I.injectProductNameSearch(signal("shoe")), called: () => client.products.searchByName },
  { name: "injectProductSearch", resource: "product-search", run: () => I.injectProductSearch(signal("name:x" as never), signal({})), called: () => client.products.search },
  { name: "injectProductsByCodes", resource: "products-by-codes", run: () => I.injectProductsByCodes(signal(["b", "a"])), called: () => client.products.searchByCodes },
  { name: "injectVariantChildren", resource: "variant-children", run: () => I.injectVariantChildren(signal("v1"), signal({})), called: () => client.products.listVariantChildren },
  { name: "injectCategory", resource: "category", run: () => I.injectCategory(signal("c1")), called: () => client.categories.get },
  { name: "injectCategories", resource: "categories", run: () => I.injectCategories(signal({})), called: () => client.categories.list },
  { name: "injectCategoryTree", resource: "category-tree", run: () => I.injectCategoryTree(), called: () => client.categories.tree },
  { name: "injectCategoryParents", resource: "category-parents", run: () => I.injectCategoryParents(signal("c1")), called: () => client.categories.parents },
  { name: "injectChildCategories", resource: "child-categories", run: () => I.injectChildCategories(signal("c1")), called: () => client.categories.childCategories },
  { name: "injectSubcategories", resource: "subcategories", run: () => I.injectSubcategories(signal("c1"), signal({})), called: () => client.categories.subcategories },
  { name: "injectCategorySearch", resource: "category-search", run: () => I.injectCategorySearch(signal("name:x" as never), signal({})), called: () => client.categories.search },
  { name: "injectCategoryTreeById", resource: "category-tree-by-id", run: () => I.injectCategoryTreeById(signal("c1")), called: () => client.categories.getTree },
  { name: "injectCategoriesInfinite", resource: "categories-infinite", run: () => I.injectCategoriesInfinite(signal(5)), called: () => client.categories.list },
  { name: "injectProductsInCategory", resource: "products-in-category", run: () => I.injectProductsInCategory(signal("c1"), signal({})), called: () => client.categories.productsIn },
  { name: "injectProductsInCategoryInfinite", resource: "products-in-category-infinite", run: () => I.injectProductsInCategoryInfinite(signal("c1"), signal(5)), called: () => client.categories.productsIn },
  { name: "injectMatchPrices", resource: "match-prices", run: () => I.injectMatchPrices(signal({ items: [{ itemId: { itemType: "PRODUCT", id: "p1" } }] } as never)), called: () => client.prices.matchByContext },
  { name: "injectMatchPricesChunked", resource: "match-prices-chunked", run: () => I.injectMatchPricesChunked(signal({ items: [{ itemId: { itemType: "PRODUCT", id: "p1" } }] } as never)), called: () => client.prices.matchByContextChunked },
  { name: "injectAvailability", resource: "availability", run: () => I.injectAvailability(signal("p1"), signal("main")), called: () => client.availability.get },
  { name: "injectAvailabilities", resource: "availabilities", run: () => I.injectAvailabilities(signal(["p2", "p1"]), signal("main")), called: () => client.availability.getMany },
  { name: "injectCartValidation", resource: "cart-validation", run: () => I.injectCartValidation(signal("cart-1")), called: () => client.carts.validate },
  { name: "injectPaymentMode", resource: "payment-mode", run: () => I.injectPaymentMode(signal("pm1")), called: () => client.payments.getMode },
  { name: "injectCart", resource: "cart", run: () => I.injectCart(signal("cart-1")), called: () => client.carts.get },
  { name: "injectCartItems", resource: "cart-items", run: () => I.injectCartItems(signal("cart-1")), called: () => client.carts.listItems },
  { name: "injectActiveCart", resource: "cart-bootstrap", run: () => I.injectActiveCart({ create: true }), called: () => client.carts.getCurrent },
  { name: "injectPaymentModes", resource: "payment-modes", run: () => I.injectPaymentModes(), called: () => client.payments.listPaymentModes },
  { name: "injectShippingZones", resource: "shipping-zones", run: () => I.injectShippingZones(), called: () => client.shipping.listZones },
  { name: "injectSites", resource: "sites", run: () => I.injectSites(), called: () => client.sites.list },
  { name: "injectCloudFunction", resource: "cloud-function", run: () => I.injectCloudFunction(signal("fn1")), called: () => client.cloudFunctions.invoke },
];

describe.each(guestReads)("$name", ({ resource, run, called }) => {
  beforeEach(() => {
    boot(false);
  });

  it("issues its request and keys it under the emporix namespace", async () => {
    TestBed.runInInjectionContext(run);
    await settleUntil(() => expect(called()).toHaveBeenCalled());
    expectKeyShape(resource);
  });
});

/** Reads that are token-gated: nothing for a guest, a request once signed in. */
const customerReads: Array<{
  name: string;
  resource: string;
  run: () => unknown;
  called: () => ReturnType<typeof vi.fn>;
}> = [
  { name: "injectMyOrders", resource: "my-orders", run: () => I.injectMyOrders(signal({})), called: () => client.orders.listMine },
  { name: "injectMyOrdersInfinite", resource: "my-orders-infinite", run: () => I.injectMyOrdersInfinite(signal(5)), called: () => client.orders.listMine },
  { name: "injectOrder", resource: "order", run: () => I.injectOrder(signal("o1")), called: () => client.orders.get },
  { name: "injectCustomerAddresses", resource: "customer-addresses", run: () => I.injectCustomerAddresses(), called: () => client.customers.addresses.list },
  { name: "injectCustomerAddress", resource: "customer-address", run: () => I.injectCustomerAddress(signal("a1")), called: () => client.customers.addresses.get },
  { name: "injectSalesOrder", resource: "sales-order", run: () => I.injectSalesOrder(signal("EON1")), called: () => client.salesOrders.get },
  { name: "injectShoppingLists", resource: "shopping-lists", run: () => I.injectShoppingLists(), called: () => client.shoppingLists.list },
  { name: "injectMyRewardPoints", resource: "reward-points", run: () => I.injectMyRewardPoints(), called: () => client.rewardPoints.getMyPoints },
  { name: "injectMyRewardPointsSummary", resource: "reward-points-summary", run: () => I.injectMyRewardPointsSummary(), called: () => client.rewardPoints.getMySummary },
  { name: "injectRedeemOptions", resource: "reward-redeem-options", run: () => I.injectRedeemOptions(), called: () => client.rewardPoints.listRedeemOptions },
  { name: "injectMyReturns", resource: "returns", run: () => I.injectMyReturns(signal({})), called: () => client.returns.listReturns },
  { name: "injectReturn", resource: "return", run: () => I.injectReturn(signal("r1")), called: () => client.returns.getReturn },
  { name: "injectMySegments", resource: "segments", run: () => I.injectMySegments(signal({})), called: () => client.segments.list },
  { name: "injectMySegmentItems", resource: "segment-items", run: () => I.injectMySegmentItems(signal({})), called: () => client.segments.listItems },
  { name: "injectMySegmentProducts", resource: "segment-products", run: () => I.injectMySegmentProducts(signal({})), called: () => client.segments.listMyProducts },
  { name: "injectMySegmentProductsInfinite", resource: "segment-products-infinite", run: () => I.injectMySegmentProductsInfinite(signal({}), signal(10)), called: () => client.segments.listMyProducts },
  { name: "injectMySegmentCategories", resource: "segment-categories", run: () => I.injectMySegmentCategories(signal({})), called: () => client.segments.listMyCategories },
  { name: "injectMySegmentCategoriesInfinite", resource: "segment-categories-infinite", run: () => I.injectMySegmentCategoriesInfinite(signal({}), signal(10)), called: () => client.segments.listMyCategories },
  { name: "injectMySegmentCategoryTree", resource: "segment-category-tree", run: () => I.injectMySegmentCategoryTree(signal({})), called: () => client.segments.getCategoryTree },
  { name: "injectApprovals", resource: "approvals", run: () => I.injectApprovals(signal({})), called: () => client.approvals.listApprovals },
  { name: "injectApproval", resource: "approval", run: () => I.injectApproval(signal("ap1")), called: () => client.approvals.getApproval },
  { name: "injectMyCompanies", resource: "my-companies", run: () => I.injectMyCompanies(), called: () => client.companies.listMine },
  { name: "injectCompany", resource: "company", run: () => I.injectCompany(signal("le1")), called: () => client.companies.get },
  { name: "injectCompanyContacts", resource: "company-contacts", run: () => I.injectCompanyContacts(signal("le1")), called: () => client.contacts.listForCompany },
  { name: "injectCompanyGroups", resource: "company-groups", run: () => I.injectCompanyGroups(signal("le1")), called: () => client.customerGroups.listForCompany },
  { name: "injectCompanyLocations", resource: "company-locations", run: () => I.injectCompanyLocations(signal("le1")), called: () => client.locations.listForCompany },
];

describe.each(customerReads)("$name", ({ resource, run, called }) => {
  it("fetches nothing for a guest", async () => {
    boot(false);
    TestBed.runInInjectionContext(run);
    TestBed.inject(ApplicationRef).tick();
    await new Promise((r) => setTimeout(r, 0));
    TestBed.inject(ApplicationRef).tick();
    expect(called()).not.toHaveBeenCalled();
  });

  it("fetches once signed in, keyed as customer", async () => {
    boot(true);
    TestBed.runInInjectionContext(run);
    await settleUntil(() => expect(called()).toHaveBeenCalled());
    expectKeyShape(resource);
    const entry = qc
      .getQueryCache()
      .getAll()
      .find((e) => e.queryKey[1] === resource);
    const meta = entry?.queryKey[entry.queryKey.length - 1] as Record<string, unknown>;
    expect(meta.authKind).toBe("customer");
  });
});

describe("every cart mutation reaches its facade method", () => {
  beforeEach(() => {
    boot(false);
    storage.setCartId("cart-1");
  });

  const ops: Array<[string, (m: I.EmporixCartMutations) => Promise<unknown>, () => ReturnType<typeof vi.fn>]> = [
    ["addItem", (m) => m.addItem({ itemYrn: "urn:x", quantity: 1 } as never), () => client.carts.addItem],
    ["updateItem", (m) => m.updateItem({ itemId: "i1", patch: {} as never }), () => client.carts.updateItem],
    ["removeItem", (m) => m.removeItem("i1"), () => client.carts.removeItem],
    ["clear", (m) => m.clear(), () => client.carts.clear],
    ["applyCoupon", (m) => m.applyCoupon("SAVE"), () => client.carts.applyCoupon],
    ["removeCoupon", (m) => m.removeCoupon("SAVE"), () => client.carts.removeCoupon],
    ["refresh", (m) => m.refresh(), () => client.carts.refresh],
    ["changeSite", (m) => m.changeSite("other"), () => client.carts.changeSite],
    ["changeCurrency", (m) => m.changeCurrency("EUR"), () => client.carts.changeCurrency],
    ["setShippingAddress", (m) => m.setShippingAddress({} as never), () => client.carts.setShippingAddress],
    ["setBillingAddress", (m) => m.setBillingAddress({} as never), () => client.carts.setBillingAddress],
  ];

  it.each(ops)("%s", async (_name, call, called) => {
    const m = TestBed.runInInjectionContext(() => I.injectCartMutations());
    await call(m);
    // The cart id is resolved at call time and passed first, always.
    expect(called()).toHaveBeenCalledWith("cart-1", ...([] as unknown[]).concat(
      called().mock.calls[0]?.slice(1) ?? [],
    ));
    expect(m.error()).toBeNull();
    expect(m.isPending()).toBe(false);
  });
});

describe("the remaining mutation injectables", () => {
  it("injectCreateCart adopts the new cart — cartId, not id", async () => {
    boot(false);
    const create = TestBed.runInInjectionContext(() => I.injectCreateCart());
    const result = await create.create();
    expect(result.cartId).toBe("cart-2");
    expect(storage.getCartId()).toBe("cart-2");
  });

  it("injectInitializePayment sends the resolved auth context", async () => {
    boot(true);
    const pay = TestBed.runInInjectionContext(() => I.injectInitializePayment());
    await pay.initialize({} as never);
    expect(client.payments.initialize).toHaveBeenCalledWith({}, { kind: "customer", token: "t1" });
  });

  it("injectUpdateCustomer patches and clears its pending flag", async () => {
    boot(true);
    const upd = TestBed.runInInjectionContext(() => I.injectUpdateCustomer());
    await upd.update({ firstName: "A" } as never);
    expect(client.customers.update).toHaveBeenCalled();
    expect(upd.isPending()).toBe(false);
  });

  const addressOps: Array<[string, (m: I.EmporixAddressMutations) => Promise<unknown>, () => ReturnType<typeof vi.fn>]> = [
    ["add", (m) => m.add({} as never), () => client.customers.addresses.add],
    ["update", (m) => m.update("a1", {} as never), () => client.customers.addresses.update],
    ["remove", (m) => m.remove("a1"), () => client.customers.addresses.remove],
    ["addTags", (m) => m.addTags("a1", ["t"]), () => client.customers.addresses.addTags],
    ["removeTags", (m) => m.removeTags("a1", ["t"]), () => client.customers.addresses.removeTags],
  ];

  it.each(addressOps)("address %s reaches its facade method", async (_n, call, called) => {
    boot(true);
    const m = TestBed.runInInjectionContext(() => I.injectAddressMutations());
    await call(m);
    expect(called()).toHaveBeenCalled();
  });

  it("every address mutation refuses without a session", async () => {
    boot(false);
    const m = TestBed.runInInjectionContext(() => I.injectAddressMutations());
    await expect(m.add({} as never)).rejects.toThrow(/addAddress requires a signed-in customer/);
    expect(client.customers.addresses.add).not.toHaveBeenCalled();
  });

  it("injectPasswordReset confirms anonymously too", async () => {
    boot(false);
    const reset = TestBed.runInInjectionContext(() => I.injectPasswordReset());
    await reset.confirm({ token: "t", newPassword: "x" } as never);
    expect(client.customers.confirmPasswordReset).toHaveBeenCalledWith(
      { token: "t", newPassword: "x" },
      { kind: "anonymous" },
    );
  });
});

describe("injectProductMedia", () => {
  /**
   * The regression test for a mistake that shipped in the first draft: it called
   * `client.media.listForProduct`, which defaults to a service-account context and
   * needs a server-only scope. The symptom was an image that stayed «loading»
   * forever with no error — nothing in a diff would have shown it.
   */
  it("reads productMedia off the product and makes no Media-Service call", async () => {
    boot(false);
    client.products.get = vi.fn(async () => ({
      id: "p1",
      productMedia: [{ url: "https://example.test/a.png" }],
    })) as never;
    const media = TestBed.runInInjectionContext(() => I.injectProductMedia(signal("p1")));
    await settleUntil(() => expect(media()?.length).toBe(1));
    expect(client.media.listForProduct).not.toHaveBeenCalled();
  });
});

describe("injectActiveSite", () => {
  it("resolves the active site out of the cached list", async () => {
    boot(false);
    const active = TestBed.runInInjectionContext(() => I.injectActiveSite());
    // Derived, not fetched: no second per-site request for something the list has.
    await settleUntil(() => expect(active()?.code).toBe("main"));
    expect(client.sites.list).toHaveBeenCalledOnce();
  });
});
