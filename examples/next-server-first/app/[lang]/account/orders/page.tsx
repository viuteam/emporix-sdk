import type { Metadata } from "next";
import Link from "next/link";
import { withEmporixSession } from "@viu/emporix-sdk-next/session";
import { money, orderVM } from "@viu/emporix-examples-shared";

import { requireCustomer } from "../../../lib/require-customer";
import { emporixOptions } from "../../../lib/site-context";

/** Per visitor — see the reasoning on `app/cart/page.tsx`. */
export const metadata: Metadata = {
  title: "Orders",
  robots: { index: false, follow: true },
};

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
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ page?: string }>;
}): Promise<React.JSX.Element> {
  const { lang } = await params;
  await requireCustomer(lang, `/${lang}/account/orders`);
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const result = await withEmporixSession(
    (client, ctx) => client.orders.listMine(ctx, { pageNumber: page, pageSize: PAGE_SIZE }),
    await emporixOptions(lang),
  );

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <p className="eyebrow">
        <Link href={`/${lang}/account`} className="u-underline">
          ← Account
        </Link>
      </p>
      <h1 style={{ marginBlock: "var(--s-2) var(--s-5)" }}>
        Orders
      </h1>

      {result.items.length === 0 ? (
        <p className="muted">
          {page > 1 ? (
            <>
              Nothing on page {page}.{" "}
              <Link href={`/${lang}/account/orders`} className="u-underline">
                Back to page 1
              </Link>
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
                  {/* `prefetch={false}`: every order row leads to its own `orders.get`
                      call. A list of 20 orders would fire 20 of them while
                      scrolling. */}
                  <Link
                    href={`/${lang}/account/orders/${encodeURIComponent(vm.id)}`}
                    className="u-underline serif"
                    prefetch={false}
                  >
                    {vm.number}
                  </Link>
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
              <Link href={`/${lang}/account/orders?page=${page - 1}`} className="btn btn--outline">
                ← Previous
              </Link>
            ) : null}
            <span className="muted">Page {page}</span>
            {result.hasNextPage ? (
              <Link href={`/${lang}/account/orders?page=${page + 1}`} className="btn btn--outline">
                Next →
              </Link>
            ) : null}
          </nav>
        </>
      )}
    </main>
  );
}
