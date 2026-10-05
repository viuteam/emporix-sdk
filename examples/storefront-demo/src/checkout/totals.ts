import type { ShippingMethod } from "@viu/emporix-sdk";

/** The delivery option the shopper picked, shaped for the checkout `shipping` payload. */
export interface DeliveryChoice {
  methodId: string;
  zoneId: string;
  methodName: string;
  /** The fee as configured on the zone. */
  amount: number;
  shippingTaxCode?: string;
  /** Lowest order value at which this method costs nothing, when its fee table has such a tier. */
  freeFrom?: number;
}

export interface CheckoutTotals {
  currency: string;
  /** The site's prices include tax: show gross lines and «incl. VAT». */
  includesTax: boolean;
  /** Items after discounts. */
  itemsNet: number;
  itemsGross: number;
  /** Discounts as the cart reports them. */
  discount: number;
  /** The chosen delivery, or the cart's estimate before one is chosen. */
  deliveryNet: number;
  deliveryGross: number;
  /** VAT on items and delivery; absent when the cart reports no calculation. */
  tax?: number;
  /** What the shopper pays, gross, with the chosen delivery. Also the payment amount. */
  total: number;
  /** What fee tiers and the free-delivery threshold compare against. */
  orderValue: number;
  /** How much more the items must cost before the chosen method is free. */
  freeDeliveryGap?: number;
}

type ReadPrice = { netValue?: number; grossValue?: number; taxRate?: number };
type ReadCart = {
  currency?: string;
  totalPrice?: { currency?: string };
  subTotalPrice?: { amount?: number; currency?: string };
  shipping?: { fee?: { amount?: number } };
  calculatedPrice?: {
    price?: ReadPrice;
    discountedPrice?: ReadPrice;
    totalShipping?: ReadPrice;
    totalDiscount?: { value?: number };
  };
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * The checkout's money, built on what a live cart returns: `calculatedPrice`
 * carries the items net and gross, and a delivery estimate (the zone's first
 * method) in `totalShipping` that `finalPrice` already contains. The chosen
 * delivery replaces that estimate, taxed at the rate the cart applied to it. On a
 * tax-exclusive site the configured fee is the net amount (that is how the cart
 * treated the standard fee); on a tax-inclusive one it is taken as gross, which
 * the test tenant could not confirm. Without `calculatedPrice` it falls back to
 * `subTotalPrice` and reports no tax.
 */
export function checkoutTotals(
  cart: unknown,
  delivery: DeliveryChoice | null,
  includesTax: boolean,
): CheckoutTotals | undefined {
  const c = cart as ReadCart | null | undefined;
  const currency = c?.currency ?? c?.totalPrice?.currency ?? c?.subTotalPrice?.currency;
  const calc = c?.calculatedPrice;
  const items = calc?.discountedPrice ?? calc?.price;
  const itemsNet = items?.netValue ?? c?.subTotalPrice?.amount;
  if (!currency || itemsNet === undefined) return undefined;
  const itemsGross = items?.grossValue ?? itemsNet;
  const estimate = calc?.totalShipping;
  const factor = 1 + (estimate?.taxRate ?? 0) / 100;
  let deliveryNet: number;
  let deliveryGross: number;
  if (!delivery) {
    deliveryNet = estimate?.netValue ?? c?.shipping?.fee?.amount ?? 0;
    deliveryGross = estimate?.grossValue ?? deliveryNet;
  } else if (includesTax) {
    deliveryGross = delivery.amount;
    deliveryNet = delivery.amount / factor;
  } else {
    deliveryNet = delivery.amount;
    deliveryGross = delivery.amount * factor;
  }
  const orderValue = includesTax ? itemsGross : itemsNet;
  const out: CheckoutTotals = {
    currency,
    includesTax,
    itemsNet,
    itemsGross,
    discount: calc?.totalDiscount?.value ?? 0,
    deliveryNet,
    deliveryGross,
    total: round2(itemsGross + deliveryGross),
    orderValue,
  };
  if (calc) out.tax = round2(itemsGross - itemsNet + deliveryGross - deliveryNet);
  if (delivery?.freeFrom !== undefined && delivery.amount > 0 && orderValue < delivery.freeFrom) {
    out.freeDeliveryGap = round2(delivery.freeFrom - orderValue);
  }
  return out;
}

/** Lowest order value at which a fee table charges nothing, if it has such a tier. */
export function freeFrom(fees: ShippingMethod["fees"]): number | undefined {
  const thresholds = (fees ?? []).flatMap((f) => {
    const min = f.minOrderValue?.amount ?? 0;
    return f.cost.amount === 0 && min > 0 ? [min] : [];
  });
  return thresholds.length > 0 ? Math.min(...thresholds) : undefined;
}
