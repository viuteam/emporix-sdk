import type { Metadata } from "next";
import Link from "next/link";
import { Note, Sheet } from "../../../components/sheet";

/** Per visitor — see the reasoning on `app/cart/page.tsx`. */
export const metadata: Metadata = {
  title: "Order placed",
  robots: { index: false, follow: true },
};

export default async function CheckoutDonePage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ orderId?: string }>;
}): Promise<React.JSX.Element> {
  const { lang } = await params;
  const { orderId } = await searchParams;
  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <Sheet
        meta={{ route: "/[lang]/checkout/done", render: "dynamic", because: "searchParams" }}
        rail={
          <Note title="Not paid">
            With the <code>custom</code> payment provider Emporix creates the order in
            the <code>IN_CHECKOUT</code> status — it exists and is waiting for payment.
            The cart is closed and its cookie has been cleared.
          </Note>
        }
      >
        <p className="eyebrow">Done</p>
        <h1 style={{ marginBlock: "var(--s-2) var(--s-5)" }}>Order placed</h1>

        <div className="tblock" style={{ maxWidth: "34rem" }}>
          <div className="tblock__row">
            <div className="tblock__key">Order</div>
            <div className="tblock__val">
              {orderId !== undefined && orderId !== "" ? orderId : "(none returned)"}
            </div>
          </div>
          <div className="tblock__row">
            <div className="tblock__key">Status</div>
            <div className="tblock__val">IN_CHECKOUT</div>
          </div>
          <div className="tblock__row">
            <div className="tblock__key">Token</div>
            <div className="tblock__val tblock__val--static">
              stayed in an httpOnly cookie
            </div>
          </div>
        </div>

        <p className="cluster" style={{ marginTop: "var(--s-6)" }}>
          <Link href={`/${lang}`} className="btn btn--outline">
            Back to the catalog
          </Link>
          <Link href={`/${lang}/debug`} className="u-underline">
            Inspect the session →
          </Link>
        </p>
      </Sheet>
    </main>
  );
}
