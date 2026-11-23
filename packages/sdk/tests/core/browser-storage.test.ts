import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLocalStorage, createSessionStorage } from "../../src/core/browser-storage";

// Node 26 defines `sessionStorage` (one store for the whole process) and a
// `localStorage` getter on the server; Node 22 and 24 define neither. Every case
// stubs the globals itself, so the suite means the same on every Node version.

function fakeStorage() {
  const data = new Map<string, string>();
  return {
    getItem: vi.fn((k: string) => data.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => {
      data.set(k, v);
    }),
    removeItem: vi.fn((k: string) => {
      data.delete(k);
    }),
  };
}

const NAMES = ["sessionStorage", "localStorage"] as const;
const factory = (name: (typeof NAMES)[number]) =>
  name === "sessionStorage" ? createSessionStorage : createLocalStorage;

const saved = new Map<string, PropertyDescriptor | undefined>();

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  for (const name of NAMES) saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  }
});

describe("web storage on a server (no document)", () => {
  it.each(NAMES)("%s: falls back to memory and never writes to the global", (name) => {
    const fake = fakeStorage();
    vi.stubGlobal(name, fake);
    vi.stubGlobal("document", undefined);
    const create = factory(name);

    const a = create();
    a.setCustomerToken("tok-a");

    expect(fake.setItem).not.toHaveBeenCalled();
    expect(create().getCustomerToken()).toBeNull(); // a second instance shares nothing
    expect(a.getCustomerToken()).toBe("tok-a");
    expect(console.warn).toHaveBeenCalledWith(
      `[emporix] ${name} unavailable; falling back to in-memory storage`,
    );
  });

  it("never reads the localStorage global (Node 26 warns on that read)", () => {
    const getter = vi.fn(() => fakeStorage());
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get: getter });
    vi.stubGlobal("document", undefined);

    createLocalStorage();

    expect(getter).not.toHaveBeenCalled();
  });

  it("in an edge runtime with neither, both fall back without throwing", () => {
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("localStorage", undefined);
    vi.stubGlobal("sessionStorage", undefined);

    for (const create of [createLocalStorage, createSessionStorage]) {
      const store = create();
      store.setCartId("cart-1");
      expect(store.getCartId()).toBe("cart-1");
    }
  });
});

describe("web storage in a browser (document present)", () => {
  it.each(NAMES)("%s: uses the Web Storage", (name) => {
    const fake = fakeStorage();
    vi.stubGlobal(name, fake);
    vi.stubGlobal("document", { cookie: "" });

    factory(name)().setCustomerToken("tok");

    expect(fake.setItem).toHaveBeenCalledWith("emporix.customerToken", "tok");
    expect(console.warn).not.toHaveBeenCalled();
  });

  it.each(NAMES)("%s: storage switched off (null, as in a WebView), falls back to memory", (name) => {
    vi.stubGlobal(name, null);
    vi.stubGlobal("document", { cookie: "" });

    const store = factory(name)();
    store.setCustomerToken("tok");

    expect(store.getCustomerToken()).toBe("tok");
    expect(console.warn).toHaveBeenCalledWith(
      `[emporix] ${name} unavailable; falling back to in-memory storage`,
    );
  });

  it.each(NAMES)("%s: storage that throws on access (blocked), falls back to memory", (name) => {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get: () => {
        throw new Error("SecurityError: access denied");
      },
    });
    vi.stubGlobal("document", { cookie: "" });

    const store = factory(name)();
    store.setCartId("cart-1");

    expect(store.getCartId()).toBe("cart-1");
    expect(console.warn).toHaveBeenCalledWith(
      `[emporix] ${name} unavailable; falling back to in-memory storage`,
    );
  });

  it.each(NAMES)("%s: without the storage itself, falls back to memory", (name) => {
    vi.stubGlobal(name, undefined);
    vi.stubGlobal("document", { cookie: "" });

    const store = factory(name)();
    store.setCustomerToken("tok");

    expect(store.getCustomerToken()).toBe("tok");
    expect(console.warn).toHaveBeenCalledWith(
      `[emporix] ${name} unavailable; falling back to in-memory storage`,
    );
  });
});
