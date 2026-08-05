export default async function CheckoutDonePage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string }>;
}): Promise<React.JSX.Element> {
  const { orderId } = await searchParams;
  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <p className="eyebrow">Done</p>
      <h1 className="serif" style={{ marginBlock: "var(--s-2) var(--s-4)" }}>
        Order placed
      </h1>
      <p className="muted" style={{ marginBottom: "var(--s-6)" }}>
        Order <code>{orderId !== undefined && orderId !== "" ? orderId : "(none returned)"}</code>
      </p>

      <div className="surface form-col" style={{ padding: "var(--s-5)", maxWidth: "52ch" }}>
        <div className="stack">
          <p>
            With the <code>custom</code> payment provider Emporix creates the order in the{" "}
            <code>IN_CHECKOUT</code> status — it exists and is waiting for payment, it is not paid.
            The cart is closed and its cookie has been cleared.
          </p>
          <p className="muted">
            The <code>saasToken</code> used for this order stayed in an httpOnly cookie the whole
            time. Check{" "}
            <a href="/debug" className="u-underline">
              /debug
            </a>
            .
          </p>
        </div>
      </div>

      <p style={{ marginTop: "var(--s-5)" }}>
        <a href="/" className="btn btn--outline">
          Back to the catalog
        </a>
      </p>
    </main>
  );
}
