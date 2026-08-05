import { notFound } from "next/navigation";
import { EmporixNotFoundError } from "@viu/emporix-sdk";
import { withEmporixSession } from "@viu/emporix-sdk-next/session";
import { money, orderItems, orderVM } from "@viu/emporix-examples-shared";

import { requireCustomer } from "../../../lib/require-customer";
import { ActionForm } from "../../../components/action-form";
import { cancelOrder, reorder } from "../../../actions/account";
import { emporixOptions } from "../../../lib/site-context";

/**
 * One order, with the two things a shopper does with one.
 *
 * Both actions are Server Actions and not client fetches, and for the same reason:
 * `orders.cancel` wants the `saasToken`, which lives in the session and must never
 * reach the browser.
 */
export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  await requireCustomer(`/account/orders/${id}`);

  let order: unknown;
  try {
    order = await withEmporixSession((client, ctx) => client.orders.get(id, ctx), await emporixOptions());
  } catch (e) {
    // An order id in a URL outlives nothing, but a wrong one is still a 404 rather
    // than a server error — same reasoning as the product page.
    if (e instanceof EmporixNotFoundError) notFound();
    throw e;
  }

  const vm = orderVM(order);
  const items = orderItems(order);

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <p className="eyebrow">
        <a href="/account/orders" className="u-underline">
          ← Orders
        </a>
      </p>
      <h1 style={{ marginBlock: "var(--s-2) var(--s-2)" }}>
        {vm.number}
      </h1>
      <p className="muted" style={{ marginBottom: "var(--s-6)" }}>
        <span className="tag">{vm.status}</span> {vm.createdAt ?? ""}
      </p>

      <ul style={{ listStyle: "none", padding: 0 }}>
        {items.map((i) => (
          <li
            key={i.id}
            className="cart__line cluster"
            style={{ gap: "var(--s-4)", alignItems: "baseline" }}
          >
            {/* The name is on the ORDER line — unlike a cart line, which carries
                an empty `product` and needs a separate lookup. */}
            <span style={{ fontWeight: 500 }}>{i.name}</span>
            <span className="muted">× {i.quantity}</span>
            <span className="price" style={{ marginLeft: "auto" }}>
              {i.lineTotal ? money(i.lineTotal.amount, i.lineTotal.currency) : ""}
            </span>
          </li>
        ))}
      </ul>

      <p className="price" style={{ marginTop: "var(--s-4)" }}>
        Total {vm.total ? money(vm.total.amount, vm.total.currency) : "—"}
      </p>

      <div className="cluster" style={{ gap: "var(--s-4)", marginTop: "var(--s-6)" }}>
        <ActionForm action={reorder} submit="Reorder">
          <input type="hidden" name="orderId" value={vm.id} />
        </ActionForm>
        <ActionForm action={cancelOrder} submit="Cancel order">
          <input type="hidden" name="orderId" value={vm.id} />
        </ActionForm>
      </div>
    </main>
  );
}
