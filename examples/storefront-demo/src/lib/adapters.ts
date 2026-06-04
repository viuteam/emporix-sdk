import { productIdFromYrn } from "@viu/emporix-sdk";
import type { Product, Media, PriceMatch } from "@viu/emporix-sdk";

/**
 * View-model adapters — the SINGLE place that reads SDK/generated field names.
 * If Emporix changes a read shape, fix it here, not across the UI.
 */

const LOCALE_ORDER = ["en", "en-US", "de", "de-CH", "de-DE"];

/** Pick a string from a localized `{ locale: value }` map. */
export function localized(map: Record<string, string> | undefined, fallback = ""): string {
  if (!map) return fallback;
  for (const l of LOCALE_ORDER) {
    const v = map[l];
    if (v) return v;
  }
  const first = Object.values(map)[0];
  return first ?? fallback;
}

/**
 * A text field that may be a plain string OR a localized map — Emporix returns
 * both shapes across tenants/versions, so handle both (a bare string must NOT
 * be treated as a char map).
 */
export function pickText(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") return localized(v as Record<string, string>, fallback);
  return fallback;
}

// Structural read shapes (Product is a union; we only read a safe subset).
type ReadProduct = {
  id?: string;
  code?: string;
  name?: unknown;
  description?: unknown;
  media?: Media[];
};

export interface ProductCardVM {
  id: string;
  code: string;
  name: string;
  image?: string;
  imageAlt: string;
}

export function imageOf(media: Media[] | undefined): string | undefined {
  const m = media?.[0];
  return m?.url ?? m?.cloudinaryUrl;
}

export function toProductCard(p: Product): ProductCardVM {
  const r = p as ReadProduct;
  const id = r.id ?? "";
  const code = r.code ?? id;
  const name = pickText(r.name, code);
  const image = imageOf(r.media);
  const vm: ProductCardVM = { id, code, name, imageAlt: name };
  if (image) vm.image = image;
  return vm;
}

export function productName(p: Product): string {
  return pickText((p as ReadProduct).name, (p as ReadProduct).code ?? "");
}

/** Last-resort tag strip (SSR / no-DOM fallback for the HTML sanitizer). */
function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const UNSAFE_TAGS = "script,style,iframe,object,embed,link,meta,base,form,input,template";

/**
 * Sanitize merchant-authored description HTML for safe rendering. Emporix
 * descriptions may contain markup; we keep it (so it renders, not stripped)
 * but drop script/style/embeds, `on*` handlers and `javascript:` URLs, and
 * harden links. Uses the browser DOMParser — robust parsing, no dependency.
 * For untrusted / user-generated HTML prefer a vetted sanitizer (e.g. DOMPurify).
 */
export function sanitizeHtml(html: string): string {
  if (typeof DOMParser === "undefined") return stripHtml(html); // no-DOM fallback
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll(UNSAFE_TAGS).forEach((el) => el.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || /^\s*javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
    if (el.tagName === "A" && el.getAttribute("href")) {
      el.setAttribute("rel", "noopener noreferrer nofollow");
      el.setAttribute("target", "_blank");
    }
  });
  return doc.body.innerHTML.trim();
}

/** Product description as sanitized HTML, ready for `dangerouslySetInnerHTML`. */
export function productDescription(p: Product): string {
  return sanitizeHtml(pickText((p as ReadProduct).description, ""));
}

export function productImages(p: Product): Media[] {
  return (p as ReadProduct).media ?? [];
}

/** Build the `matchByContext` items payload for a set of products (quantity is required). */
export function priceMatchItems(
  products: Product[],
): Array<{ itemId: { itemType: string; id: string }; quantity: { quantity: number } }> {
  return products
    .map((p) => (p as ReadProduct).id)
    .filter((id): id is string => Boolean(id))
    .map((id) => ({ itemId: { itemType: "PRODUCT", id }, quantity: { quantity: 1 } }));
}

export interface PriceVM {
  amount: number;
  currency: string;
  /** The matched price's id — required by the cart when adding internal-type products. */
  priceId?: string;
}

type ReadMatch = {
  // Live response keys the product under `itemId`; the generated type calls it
  // `itemRef`. Match either.
  itemId?: { id?: string };
  itemRef?: { id?: string };
  priceId?: string;
  effectiveValue?: number;
  totalValue?: number;
  originalValue?: number;
  currency?: string;
};

/** Category label — tolerates a plain string or a localized map. */
export function catLabel(c: unknown): string {
  const o = c as { id?: string; code?: string; name?: unknown; localizedName?: Record<string, string> };
  if (o.localizedName) return localized(o.localizedName);
  if (typeof o.name === "string") return o.name;
  if (o.name && typeof o.name === "object") return localized(o.name as Record<string, string>);
  return o.code ?? o.id ?? "";
}

export function catId(c: unknown): string {
  return (c as { id?: string }).id ?? "";
}

/** Find the matched price for a product id within a `matchByContext` result. */
export function priceForProduct(matches: PriceMatch[] | undefined, productId: string): PriceVM | undefined {
  const m = (matches as ReadMatch[] | undefined)?.find((x) => (x.itemId?.id ?? x.itemRef?.id) === productId);
  if (!m) return undefined;
  const amount = m.effectiveValue ?? m.totalValue;
  if (amount === undefined || !m.currency) return undefined;
  return { amount, currency: m.currency, ...(m.priceId ? { priceId: m.priceId } : {}) };
}

/** The YRN the cart's `addItem` expects for a product (verified against viu). */
export function productYrn(tenant: string, productId: string): string {
  return `urn:yaas:hybris:product:product:${tenant};${productId}`;
}


// --- Cart ---

type ReadPrice = { amount?: number; effectiveAmount?: number; totalValue?: number; currency?: string };

function toPriceVM(p: ReadPrice | undefined | null): PriceVM | undefined {
  const amount = p?.amount ?? p?.effectiveAmount ?? p?.totalValue;
  if (amount === undefined || !p?.currency) return undefined;
  return { amount, currency: p.currency };
}

/** The `PriceRowItem` the cart stores/echoes per line — re-sent on update. */
export interface CartLinePrice {
  priceId: string;
  originalAmount: number;
  effectiveAmount: number;
  currency: string;
}
type ReadCartItem = {
  id?: string;
  itemYrn?: string;
  quantity?: number;
  product?: { id?: string; name?: unknown; media?: Media[] };
  price?: Partial<CartLinePrice>;
  totalPrice?: ReadPrice;
};

export interface CartLineVM {
  id: string;
  /** Product id (from `itemYrn`) — the cart item carries no product details, so names are resolved separately. */
  productId: string;
  name: string;
  quantity: number;
  image?: string;
  unit?: PriceVM;
  lineTotal?: PriceVM;
  /** Echoed identifiers/price row — the cart requires them back on updates (PUT replaces the line). */
  itemYrn?: string;
  price?: CartLinePrice;
}

export function toCartLine(item: unknown): CartLineVM {
  const r = item as ReadCartItem;
  const quantity = r.quantity ?? 1;
  const productId = (r.product?.id as string | undefined) ?? productIdFromYrn(r.itemYrn);
  const vm: CartLineVM = {
    id: r.id ?? "",
    productId,
    // The cart GET returns an empty `product`; fall back to the id until the
    // name is resolved (see the Cart page's name lookup).
    name: pickText(r.product?.name, ""),
    quantity,
  };
  if (r.itemYrn) vm.itemYrn = r.itemYrn;
  const image = imageOf(r.product?.media);
  if (image) vm.image = image;

  const p = r.price;
  if (p?.priceId && p.currency && p.effectiveAmount !== undefined) {
    vm.price = {
      priceId: p.priceId,
      originalAmount: p.originalAmount ?? p.effectiveAmount,
      effectiveAmount: p.effectiveAmount,
      currency: p.currency,
    };
    vm.unit = { amount: p.effectiveAmount, currency: p.currency };
    vm.lineTotal = { amount: p.effectiveAmount * quantity, currency: p.currency };
  }
  return vm;
}

export function cartLines(cart: unknown): CartLineVM[] {
  const items = (cart as { items?: unknown[] } | null | undefined)?.items ?? [];
  return items.map(toCartLine);
}

export function cartTotal(cart: unknown): PriceVM | undefined {
  return toPriceVM((cart as { totalPrice?: ReadPrice } | null | undefined)?.totalPrice);
}

/** Coupon codes currently applied to the cart (best-effort across shapes). */
export function cartCoupons(cart: unknown): string[] {
  const c = cart as { coupons?: Array<{ code?: string }> } | null | undefined;
  return (c?.coupons ?? []).map((x) => x.code).filter((x): x is string => Boolean(x));
}

// --- Orders ---

// Emporix returns two order shapes: the LIST/normalized shape (`items`,
// `totalPrice: {amount,currency}`, top-level `orderNumber`) and the GET-by-id
// raw shape (`entries`, `totalPrice: <number>` + top-level `currency`,
// `orderNumber` under `mixins.generalAttributes`). These helpers read both.

/** A money value that may be a plain number (currency lives elsewhere) or a `{amount|value, currency}` object. */
type ReadMoneyish = number | { amount?: number; value?: number; currency?: string } | null | undefined;

function moneyVM(v: ReadMoneyish, fallbackCurrency?: string): PriceVM | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "number") {
    return fallbackCurrency ? { amount: v, currency: fallbackCurrency } : undefined;
  }
  const amount = v.amount ?? v.value;
  const currency = v.currency ?? fallbackCurrency;
  if (amount === undefined || !currency) return undefined;
  return { amount, currency };
}

type ReadOrderItem = {
  id?: string;
  productId?: string;
  productName?: unknown;
  product?: { id?: string; name?: unknown; localizedName?: Record<string, string>; media?: Media[] };
  imageUrl?: string;
  quantity?: number;
  orderedAmount?: number;
  amount?: number;
  unitPrice?: ReadMoneyish;
  totalPrice?: ReadMoneyish;
};
type ReadOrder = {
  id?: string;
  orderNumber?: string;
  status?: string;
  currency?: string;
  totalPrice?: ReadMoneyish;
  items?: ReadOrderItem[];
  entries?: ReadOrderItem[];
  created?: string;
  metadata?: { createdAt?: string };
  mixins?: { generalAttributes?: { orderNumber?: string } };
};

function orderLineItems(r: ReadOrder): ReadOrderItem[] {
  return r.items ?? r.entries ?? [];
}

export interface OrderVM {
  id: string;
  number: string;
  status: string;
  total?: PriceVM;
  createdAt?: string;
  itemCount: number;
}

export function orderVM(o: unknown): OrderVM {
  const r = (o ?? {}) as ReadOrder;
  const vm: OrderVM = {
    id: r.id ?? "",
    number: r.orderNumber ?? r.mixins?.generalAttributes?.orderNumber ?? r.id ?? "",
    status: r.status ?? "—",
    itemCount: orderLineItems(r).length,
  };
  const total = moneyVM(r.totalPrice, r.currency);
  if (total) vm.total = total;
  const createdAt = r.created ?? r.metadata?.createdAt;
  if (createdAt) vm.createdAt = createdAt;
  return vm;
}

export interface OrderItemVM {
  id: string;
  productId: string;
  name: string;
  quantity: number;
  image?: string;
  unit?: PriceVM;
  lineTotal?: PriceVM;
}

export function orderItems(o: unknown): OrderItemVM[] {
  const r = (o ?? {}) as ReadOrder;
  const currency = r.currency;
  return orderLineItems(r).map((i) => {
    const vm: OrderItemVM = {
      id: i.id ?? "",
      productId: i.productId ?? i.product?.id ?? "",
      name: pickText(i.product?.name ?? i.product?.localizedName ?? i.productName, i.productId ?? ""),
      quantity: i.quantity ?? i.orderedAmount ?? i.amount ?? 0,
    };
    const image = i.imageUrl ?? imageOf(i.product?.media);
    if (image) vm.image = image;
    const unit = moneyVM(i.unitPrice, currency);
    if (unit) vm.unit = unit;
    const line = moneyVM(i.totalPrice, currency);
    if (line) vm.lineTotal = line;
    return vm;
  });
}
