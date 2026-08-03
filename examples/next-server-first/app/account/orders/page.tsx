import { withEmporixSession } from "@viu/emporix-sdk-next/session";
import { money, orderVM } from "@viu/emporix-examples-shared";

import { requireCustomer } from "../../lib/require-customer";
import { emporixOptions } from "../../lib/site-context";

const PAGE_SIZE = 10;

/**
 * Order history, paginated through the URL like `/category/[id]`.
 *
 * `orderVM` reads both shapes Emporix returns: the list shape (`items`,
 * `totalPrice: { amount, currency }`, top-level `orderNumber`) and the get-by-id
 * shape (`entries`, `totalPrice: <number>` plus a sibling `currency`,
 * `orderNumber` under `mixins.generalAttributes`). This page hits the first, the
 * detail page the second, and neither has to know.
 */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}): Promise<React.JSX.Element> {
  await requireCustomer("/account/orders");
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const result = await withEmporixSession(
    (client, ctx) => client.orders.listMine(ctx, { pageNumber: page, pageSize: PAGE_SIZE }),
    await emporixOptions(),
  );

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <p className="eyebrow">
        <a href="/account" className="u-underline">
          ← Account
        </a>
      </p>
      <h1 className="serif" style={{ marginBlock: "var(--s-2) var(--s-5)" }}>
        Orders
      </h1>

      {result.items.length === 0 ? (
        <p className="muted">
          {page > 1 ? (
            <>
              Nothing on page {page}.{" "}
              <a href="/account/orders" className="u-underline">
                Back to page 1
              </a>
              .
            </>
          ) : (
            "No orders yet."
          )}
        </p>
      ) : (
        <>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {result.items.map((o) => {
              const vm = orderVM(o);
              return (
                <li
                  key={vm.id}
                  className="surface cluster"
                  style={{ marginBottom: "var(--s-3)", gap: "var(--s-4)", alignItems: "baseline" }}
                >
                  <a
                    href={`/account/orders/${encodeURIComponent(vm.id)}`}
                    className="u-underline serif"
                  >
                    {vm.number}
                  </a>
                  <span className="tag">{vm.status}</span>
                  <span className="muted">{vm.createdAt ?? ""}</span>
                  <span className="muted">{vm.itemCount} item(s)</span>
                  <span className="price" style={{ marginLeft: "auto" }}>
                    {vm.total ? money(vm.total.amount, vm.total.currency) : "—"}
                  </span>
                </li>
              );
            })}
          </ul>
          <nav
            className="cluster"
            aria-label="Pagination"
            style={{ gap: "var(--s-4)", marginTop: "var(--s-6)", alignItems: "center" }}
          >
            {page > 1 ? (
              <a href={`/account/orders?page=${page - 1}`} className="btn btn--outline">
                ← Previous
              </a>
            ) : null}
            <span className="muted">Page {page}</span>
            {result.hasNextPage ? (
              <a href={`/account/orders?page=${page + 1}`} className="btn btn--outline">
                Next →
              </a>
            ) : null}
          </nav>
        </>
      )}
    </main>
  );
}
