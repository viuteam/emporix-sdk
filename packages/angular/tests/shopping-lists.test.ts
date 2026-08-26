import { describe, expect, it, vi } from "vitest";
import { ApplicationRef, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { QueryClient } from "@tanstack/angular-query-experimental";
import { createMemoryStorage, type EmporixStorage } from "@viu/emporix-sdk";
import { provideEmporix } from "../src/provide";
import {
  injectShoppingListMutations,
  injectShoppingLists,
} from "../src/injectables/shopping-lists";

type Mock = ReturnType<typeof vi.fn>;
interface Calls {
  list: Mock;
  create: Mock;
  del: Mock;
  addItem: Mock;
  removeItem: Mock;
  setItemQuantity: Mock;
  me: Mock;
}

let storage: EmporixStorage;
let qc: QueryClient;
let calls: Calls;

function boot(signedIn: boolean, overrides: Partial<Calls> = {}): void {
  storage = createMemoryStorage();
  if (signedIn) storage.setCustomerToken("t1");
  qc = new QueryClient();
  calls = {
    list: vi.fn(async () => [{ name: "wishlist", items: [] }]),
    create: vi.fn(async () => ({ id: "l1" })),
    del: vi.fn(async () => undefined),
    addItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
    setItemQuantity: vi.fn(async () => undefined),
    me: vi.fn(async () => ({ id: "cust-1", contactEmail: "a@b.ch" })),
    ...overrides,
  } as unknown as Calls;
  const client = {
    tenant: "acme",
    config: {},
    shoppingLists: {
      list: calls.list,
      create: calls.create,
      delete: calls.del,
      addItem: calls.addItem,
      removeItem: calls.removeItem,
      setItemQuantity: calls.setItemQuantity,
    },
    customers: { me: calls.me, login: vi.fn(), logout: vi.fn() },
  } as never;
  TestBed.configureTestingModule({
    providers: [provideEmporix({ client, storage, queryClient: qc })],
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

describe("injectShoppingLists", () => {
  /**
   * The deviation from React, and the reason this test exists first. React's
   * `useShoppingLists` calls `useCustomerOnlyCtx()` unconditionally in the hook
   * body, which throws during render when nobody is signed in. A guest is
   * allowed to visit a page that shows their (empty) lists.
   */
  it("issues no request for a guest and does not error", async () => {
    boot(false);
    const q = TestBed.runInInjectionContext(() => injectShoppingLists());
    TestBed.inject(ApplicationRef).tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.list).not.toHaveBeenCalled();
    expect(q.isError()).toBe(false);
  });

  it("fetches once a customer token is stored, auth first", async () => {
    boot(true);
    TestBed.runInInjectionContext(() => injectShoppingLists());
    await settleUntil(() => expect(calls.list).toHaveBeenCalled());
    // `shoppingLists.list(auth, opts)` — auth first, unlike every other read
    // facade in the SDK. Getting this backwards sends the options as the context.
    const [first, second] = calls.list.mock.calls[0] as [unknown, unknown];
    expect(first).toMatchObject({ kind: "customer" });
    expect(second).toEqual({});
  });

  it("re-keys when the name filter signal changes", async () => {
    boot(true);
    const name = signal<string | undefined>("wishlist");
    TestBed.runInInjectionContext(() => injectShoppingLists(name));
    await settleUntil(() => expect(calls.list).toHaveBeenCalledTimes(1));
    expect((calls.list.mock.calls[0] as [unknown, unknown])[1]).toEqual({ name: "wishlist" });
    name.set("later");
    await settleUntil(() => expect(calls.list).toHaveBeenCalledTimes(2));
  });
});

describe("injectShoppingListMutations", () => {
  it("invalidates the lists after a successful create", async () => {
    boot(true);
    const spy = vi.spyOn(qc, "invalidateQueries");
    const m = TestBed.runInInjectionContext(() => injectShoppingListMutations());
    await expect(m.create({ name: "wishlist" } as never)).resolves.toEqual({ id: "l1" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["emporix", "shopping-lists"] });
  });

  /**
   * Four of the five facade methods want the caller's own customer id. React
   * makes every call site supply it, which means a storefront has to fetch its
   * own id before it can add to a wishlist. This defaults it from the session's
   * profile — already cached under `customer-me` — and still accepts an explicit
   * one.
   */
  it("defaults customerId from the session profile", async () => {
    boot(true);
    const m = TestBed.runInInjectionContext(() => injectShoppingListMutations());
    await settleUntil(() => expect(calls.me).toHaveBeenCalled());
    await m.addItem({ listName: "wishlist", item: { productId: "p1", quantity: 1 } as never });
    expect(calls.addItem).toHaveBeenCalledWith(
      "cust-1",
      "wishlist",
      { productId: "p1", quantity: 1 },
      expect.objectContaining({ kind: "customer" }),
    );
  });

  it("accepts an explicit customerId over the session's", async () => {
    boot(true);
    const m = TestBed.runInInjectionContext(() => injectShoppingListMutations());
    await m.removeItem({ customerId: "other", listName: "wishlist", productId: "p1" });
    expect(calls.removeItem).toHaveBeenCalledWith(
      "other",
      "wishlist",
      "p1",
      expect.anything(),
    );
  });

  it("says so when neither the caller nor the session has a customer id", async () => {
    boot(true, { me: vi.fn(async () => ({ contactEmail: "a@b.ch" })) as never });
    const m = TestBed.runInInjectionContext(() => injectShoppingListMutations());
    await expect(m.remove({})).rejects.toThrow(/customerId/);
    expect(calls.del).not.toHaveBeenCalled();
  });

  it("is customer-gated: throws locally for a guest without spending a request", async () => {
    boot(false);
    const m = TestBed.runInInjectionContext(() => injectShoppingListMutations());
    await expect(m.create({ name: "x" } as never)).rejects.toThrow(
      /requires a signed-in customer/,
    );
    expect(calls.create).not.toHaveBeenCalled();
  });

  it("passes the name filter through to delete", async () => {
    boot(true);
    const m = TestBed.runInInjectionContext(() => injectShoppingListMutations());
    await settleUntil(() => expect(calls.me).toHaveBeenCalled());
    await m.remove({ name: "wishlist" });
    expect(calls.del).toHaveBeenCalledWith("cust-1", expect.anything(), { name: "wishlist" });
  });

  it("setItemQuantity forwards the quantity", async () => {
    boot(true);
    const m = TestBed.runInInjectionContext(() => injectShoppingListMutations());
    await settleUntil(() => expect(calls.me).toHaveBeenCalled());
    await m.setItemQuantity({ listName: "wishlist", productId: "p1", quantity: 3 });
    expect(calls.setItemQuantity).toHaveBeenCalledWith(
      "cust-1",
      "wishlist",
      "p1",
      3,
      expect.anything(),
    );
  });
});
