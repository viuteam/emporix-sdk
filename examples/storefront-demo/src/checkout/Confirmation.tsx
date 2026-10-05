import { Link } from "react-router-dom";
import { Alert } from "../components/ui/Alert";
import type { CartLineVM } from "../lib/adapters";
import type { ProductDetails } from "../lib/useProductNames";
import { formatAddress, type AddressDraft } from "./AddressFields";
import { OrderSummary } from "./OrderSummary";
import type { CheckoutTotals } from "./totals";

/** A snapshot taken just before submit: after the order the cart is closed. */
export interface PlacedOrder {
  orderId: string;
  email: string;
  lines: CartLineVM[];
  details: Record<string, ProductDetails>;
  totals: CheckoutTotals;
  shipping: AddressDraft;
  deliveryName: string;
  paymentLabel: string;
  signedIn: boolean;
}

export function Confirmation({ order }: { order: PlacedOrder }) {
  return (
    <div className="container confirmation">
      <Alert tone="success">
        <strong>Order placed.</strong> Order number <strong>{order.orderId}</strong>.
      </Alert>
      <h1 className="confirmation__title">Thank you</h1>
      <p className="muted">The order was created for {order.email}.</p>
      <div className="confirmation__grid">
        <div className="confirmation__block">
          <h2>Shipping address</h2>
          <p className="muted">{formatAddress(order.shipping)}</p>
        </div>
        <div className="confirmation__block">
          <h2>Delivery and payment</h2>
          <p className="muted">
            {order.deliveryName} · {order.paymentLabel}
          </p>
        </div>
      </div>
      <OrderSummary lines={order.lines} details={order.details} totals={order.totals} deliveryName={order.deliveryName} />
      <div className="co-actions">
        {order.signedIn ? (
          // Guests cannot open it: OrderDetail sits behind RequireAuth.
          <Link to={`/account/orders/${encodeURIComponent(order.orderId)}`} className="btn btn--accent">
            View order
          </Link>
        ) : null}
        <Link to="/" className="btn btn--outline">
          Continue shopping
        </Link>
      </div>
    </div>
  );
}
