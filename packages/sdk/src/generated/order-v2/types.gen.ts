/**
 * Hand-written mirror of the Emporix Order-v2 schemas (storefront-relevant
 * subset). Captures /orders, /orders/{id}, /orders/{id}/transitions, and
 * /salesorders/{id} response/body shapes.
 *
 * **Not generated.** When the OpenAPI input file lands in the repo, this
 * file is replaced by codegen output. Keep the exported names stable so
 * the façade re-exports don't churn.
 */

export type OrderStatus =
  | "CREATED"
  | "IN_CHECKOUT"
  | "CONFIRMED"
  | "SHIPPED"
  | "COMPLETED"
  | "DECLINED";

export interface OrderMoney {
  amount: number;
  currency: string;
}

export interface OrderItem {
  id: string;
  productId: string;
  productCode?: string;
  productName?: string | Record<string, string>;
  imageUrl?: string;
  quantity: number;
  unitPrice: OrderMoney;
  totalPrice: OrderMoney;
}

export interface OrderCustomer {
  id?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  guest?: boolean;
}

export interface OrderAddress {
  contactName?: string;
  companyName?: string;
  street?: string;
  streetNumber?: string;
  zip?: string;
  city?: string;
  country?: string;
}

export interface OrderPayment {
  paymentMode?: string;
  paymentStatus?: string;
  transactionId?: string;
}

export interface OrderDelivery {
  deliveryDate?: string;
  trackingNumber?: string;
  carrier?: string;
}

export interface OrderTaxLine {
  rate: number;
  amount: number;
}

export interface OrderMetadata {
  version: number;
  createdAt: string;
  modifiedAt: string;
  mixins?: Record<string, unknown>;
}

export interface Order {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  currency: string;
  totalPrice: OrderMoney;
  subTotalPrice?: OrderMoney;
  shippingPrice?: OrderMoney;
  taxAggregate?: { lines: OrderTaxLine[] };
  items: OrderItem[];
  customer?: OrderCustomer;
  billingAddress?: OrderAddress;
  shippingAddress?: OrderAddress;
  payment?: OrderPayment;
  delivery?: OrderDelivery;
  siteCode?: string;
  legalEntityId?: string;
  channel?: string;
  metadata?: OrderMetadata;
  mixins?: Record<string, unknown>;
  customAttributes?: Record<string, unknown>;
}

export interface OrderTransition {
  status: OrderStatus;
  comment?: string;
}

export interface SalesOrderPatch {
  status?: OrderStatus;
  mixins?: Record<string, unknown>;
  customAttributes?: Record<string, unknown>;
  metadata?: { version: number; mixins?: Record<string, unknown> };
}
