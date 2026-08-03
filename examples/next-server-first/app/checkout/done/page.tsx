export default async function CheckoutDonePage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string }>;
}): Promise<React.JSX.Element> {
  const { orderId } = await searchParams;
  return (
    <main>
      <h1>Order placed</h1>
      <p>Order id: {orderId || "(none returned)"}</p>
      <p>
        With the <code>custom</code> payment provider Emporix creates the order in the{" "}
        <code>IN_CHECKOUT</code> status — it exists and is waiting for payment, it is not paid. The
        cart is closed and its cookie has been cleared.
      </p>
      <p>
        The <code>saasToken</code> used for this order stayed in an httpOnly cookie the whole time.
        Check <a href="/debug">/debug</a>.
      </p>
      <a href="/">Back to the catalog</a>
    </main>
  );
}
