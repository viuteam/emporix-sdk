import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { EmporixClient, auth, type AuthContext } from "@viu/emporix-sdk";
import { prefetchEmporix, type SiteFields } from "../src/ssr";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useProduct, useProducts, useProductByCode } from "../src/hooks/use-products";
import { useCategory, useCategories, useProductsInCategory } from "../src/hooks/use-categories";
import { useCart } from "../src/hooks/use-cart";
import { useOrder } from "../src/hooks/use-order";
import { useMyOrders } from "../src/hooks/use-my-orders";
import { useSites } from "../src/hooks/use-sites";

// This suite compares KEYS, not data — every resource request is left hanging.
// The anonymous-login handler is still needed because the provider's token
// bootstrap runs on mount.
const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon",
      token_type: "Bearer",
      expires_in: 3599,
      refresh_token: "rt",
      sessionId: "s",
    }),
  ),
  http.all("https://api.emporix.io/*", () => new Promise<never>(() => {})),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** One documented row: the hook, and the descriptor a server hands prefetchEmporix. */
interface Row {
  name: string;
  render: () => unknown;
  resource: string;
  args: readonly unknown[];
  site: SiteFields;
  /** Customer-gated hooks need a stored token and a customer context. */
  customer?: boolean;
}

const PARAMS = { pageSize: 24 } as const;

const ROWS: Row[] = [
  {
    name: "useProduct",
    render: () => useProduct("p1"),
    resource: "product",
    args: ["p1"],
    site: "full",
  },
  {
    name: "useProducts",
    render: () => useProducts(PARAMS),
    resource: "products",
    args: [PARAMS],
    site: "full",
  },
  {
    name: "useProductByCode",
    render: () => useProductByCode("slug"),
    resource: "product-by-code",
    args: ["slug"],
    site: "full",
  },
  {
    name: "useCategory",
    render: () => useCategory("c1"),
    resource: "category",
    args: ["c1"],
    site: "full",
  },
  {
    name: "useCategories",
    render: () => useCategories(PARAMS),
    resource: "categories",
    args: [PARAMS],
    site: "full",
  },
  {
    name: "useProductsInCategory",
    render: () => useProductsInCategory("c1", PARAMS),
    resource: "products-in-category",
    args: ["c1", PARAMS],
    site: "full",
  },
  {
    name: "useCart",
    render: () => useCart("cart1"),
    resource: "cart",
    args: ["cart1", null],
    site: "full",
  },
  {
    name: "useOrder",
    render: () => useOrder("o1"),
    resource: "orders",
    args: ["o1"],
    site: "language",
    customer: true,
  },
  {
    name: "useMyOrders",
    render: () => useMyOrders(),
    resource: "orders",
    args: ["mine", null, null, 1, null, null],
    site: "full",
    customer: true,
  },
  { name: "useSites", render: () => useSites(), resource: "sites", args: [], site: "none" },
];

function makeClient(): EmporixClient {
  return new EmporixClient({
    tenant: "acme",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
}

describe.each(ROWS)("prefetch parity: $name", (row) => {
  it("the documented descriptor reproduces the hook's key exactly", async () => {
    const client = makeClient();
    const storage = createMemoryStorage(row.customer ? { initial: "cust" } : {});
    const hookQc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <EmporixProvider client={client} storage={storage} queryClient={hookQc}>
        {children}
      </EmporixProvider>
    );

    renderHook(() => row.render(), { wrapper });
    await waitFor(() =>
      expect(
        hookQc
          .getQueryCache()
          .getAll()
          .some((q) => q.queryKey[1] === row.resource),
      ).toBe(true),
    );
    const hookKeys = hookQc
      .getQueryCache()
      .getAll()
      .filter((q) => q.queryKey[1] === row.resource)
      .map((q) => q.queryKey);

    const ctx: AuthContext = row.customer ? auth.customer("cust") : auth.anonymous();
    const serverQc = new QueryClient();
    await prefetchEmporix(serverQc, {
      client,
      resource: row.resource,
      args: row.args,
      site: row.site,
      auth: ctx,
      queryFn: () => Promise.resolve(null),
    });
    const serverKey = serverQc.getQueryCache().getAll()[0]!.queryKey;

    // The hook's cache may hold sibling entries under the same resource
    // (useOrder vs useMyOrders both use "orders"); the descriptor must match
    // exactly one of them.
    expect(hookKeys).toContainEqual(serverKey);
  });
});
