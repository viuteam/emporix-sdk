import { productIdFromYrn } from "@viu/emporix-sdk";
import type { Product, Media, PriceMatch } from "@viu/emporix-sdk";

/**
 * View-model adapters — the SINGLE place that reads SDK/generated field names.
 * If Emporix changes a read shape, fix it here, not across the UI.
 *
 * Shared by `examples/storefront-demo`, `examples/next-server-first` and
 * `examples/angular-storefront-demo`, because the shapes these normalize are
 * Emporix's, not any one demo's: orders come back
 * in two forms, cart lines want their price row echoed on update, text fields are
 * sometimes a string and sometimes a locale map.
 *
 * Building your own storefront? **Copy these files.** This is deliberately not
 * part of the published API — see `examples/shared/README.md`.
 *
 * One thing stays behind in storefront-demo: `sanitizeHtml`, which needs
 * `DOMParser` and therefore a browser. Server-rendered consumers use
 * {@link stripHtml} and get plain text.
 */

/**
 * The fallback for when no `Accept-Language` was set.
 *
 * **The first language in this list is your site's default language.** Change it
 * when you copy this file — the list is tenant-specific and only looks like a
 * general truth.
 *
 * Why it matters at all: Emporix returns `name` and `description` as a complete
 * locale map when the request carried no `Accept-Language`. Otherwise the SDK
 * narrows the map itself and none ever reaches this function. So the list applies
 * exactly on a first contact without a cookie.
 *
 * Until 2026-08-05 it started with `en`, although every example points at the `viu`
 * tenant and `client.sites.get("main")` reports `defaultLanguage: "de"` there
 * (measured 2026-08-04). The result: the catalog under `/de/…` was German while the
 * cart in the same session was English — «Just-in-Time Zugriff (JIT)» against
 * «Just-in-Time Access (JIT)», reproduced live. The fallback now agrees with what
 * the tenant itself declares as its default.
 */
const LOCALE_ORDER = ["de", "de-CH", "de-DE", "en", "en-US"];

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
  productType?: string;
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

/**
 * Strips tags without a DOM. Pure string work, so it runs in Node as well —
 * which `sanitizeHtml` does not, because it needs `DOMParser`. A server-rendered
 * consumer gets plain text instead of markup; that is the honest trade rather
 * than pulling in a sanitizer dependency for one demo line.
 *
 * Was the private no-DOM fallback of `sanitizeHtml` before this package existed.
 *
 * `[^<>]`, not `[^>]`, and that one character is a fixed ReDoS. With `[^>]` a
 * string of `<` with no closing `>` makes the engine rescan the whole tail from
 * every `<`, which is quadratic: 20k/40k/80k `<` took 145/556/2198 ms, while this
 * version stays at 0.2 ms. Excluding `<` from the class means an unclosed tag
 * cannot swallow the rest of the input. Output on well-formed markup is identical;
 * `<a<b>` now yields one tag instead of one malformed one, which is also the more
 * defensible reading.
 */
export function stripHtml(s: string): string {
  return s
    .replace(/<[^<>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function productImages(p: Product): Media[] {
  return (p as ReadProduct).media ?? [];
}

/**
 * Whether asking for the product's variant children can find any.
 * `listVariantChildren` searches `productType:VARIANT`, and a VARIANT only ever
 * belongs to a PARENT_VARIANT; for every other type — a dynamic-variant root
 * included, whose children are DYNAMIC_VARIANT themselves — the request can
 * only answer `[]`.
 */
export function isVariantParent(p: Product): boolean {
  return (p as ReadProduct).productType === "PARENT_VARIANT";
}

// --- Dynamic variants ---
//
// A DYNAMIC_VARIANT tree (e.g. root → colour → size). The root's `variants` map
// lists every descendant; each product carries its attributes as
// `inheritedVariantAttributes` (from its ancestors) plus `ownVariantAttributes`.
//
// The map is documented to carry the accumulated attributes as well, but Emporix
// leaves `variantAttributes` out of it for storefront (anonymous) tokens — measured
// on the viu tenant 2026-10-08, a service token gets them. So the picker takes only
// the sellable codes from the map and reads those variants in one request.

type ReadVariantAttribute = { name?: unknown; value?: { qualifier?: unknown; name?: unknown } };
type ReadDynamicProduct = ReadProduct & {
  sellable?: boolean;
  parentVariantPath?: string[];
  variants?: Record<string, { code?: string; sellable?: boolean }>;
  inheritedVariantAttributes?: Record<string, ReadVariantAttribute>;
  ownVariantAttributes?: Record<string, ReadVariantAttribute>;
};

export interface VariantAxis {
  /** Attribute key, e.g. `color`. */
  key: string;
  /** Localized attribute name, e.g. «Farbe». */
  label: string;
  values: Array<{ key: string; label: string }>;
}

/**
 * The root of the product's dynamic-variant tree: the product itself when it has
 * no parent, otherwise the last entry of `parentVariantPath` (ordered from the
 * direct parent up to the root). `undefined` when it is not a dynamic variant.
 */
export function dynamicVariantRootId(p: Product): string | undefined {
  const r = p as ReadDynamicProduct;
  if (r.productType !== "DYNAMIC_VARIANT") return undefined;
  return r.parentVariantPath?.at(-1) ?? r.id;
}

/** A dynamic-variant root or intermediate node: shows the picker, but cannot go into the cart. */
export function needsVariantChoice(p: Product): boolean {
  const r = p as ReadDynamicProduct;
  return r.productType === "DYNAMIC_VARIANT" && r.sellable !== true;
}

/** Codes of the root's sellable variants — read them with one `searchByCodes`. */
export function sellableVariantCodes(root: Product): string[] {
  return Object.entries((root as ReadDynamicProduct).variants ?? {})
    .filter(([, entry]) => entry.sellable === true)
    .map(([id, entry]) => entry.code ?? id);
}

/** Inherited attributes first, then the product's own: colour before size. */
function attributesOf(p: Product): Record<string, ReadVariantAttribute> {
  const r = p as ReadDynamicProduct;
  return { ...r.inheritedVariantAttributes, ...r.ownVariantAttributes };
}

/** Apparel sizes in wearing order. Values that are not sizes sort by label. */
const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "4XL"];

/**
 * One selector per attribute, offering the values the given sellable variants
 * have. Axes follow the tree, since inherited attributes come first; values sort
 * by {@link SIZE_ORDER}, then label, because the variants arrive unordered.
 */
export function variantAxes(variants: Product[]): VariantAxis[] {
  const axes = new Map<string, VariantAxis>();
  for (const variant of variants) {
    for (const [key, attr] of Object.entries(attributesOf(variant))) {
      const axis = axes.get(key) ?? { key, label: pickText(attr.name, key), values: [] };
      axes.set(key, axis);
      const value = String(attr.value?.qualifier ?? "");
      if (value && !axis.values.some((v) => v.key === value)) {
        axis.values.push({ key: value, label: pickText(attr.value?.name, value) });
      }
    }
  }
  const rank = (key: string): number => {
    const i = SIZE_ORDER.indexOf(key.toUpperCase());
    return i === -1 ? SIZE_ORDER.length : i;
  };
  for (const axis of axes.values()) {
    axis.values.sort((a, b) => rank(a.key) - rank(b.key) || a.label.localeCompare(b.label));
  }
  return [...axes.values()];
}

/** The attribute values a product fixes: every axis for a sellable variant, fewer for a node, none for the root. */
export function variantSelection(p: Product): Record<string, string> {
  return Object.fromEntries(Object.entries(attributesOf(p)).map(([key, attr]) => [key, String(attr.value?.qualifier ?? "")]));
}

/** Ids of the variants whose attributes match every entry of `selection`. */
export function matchingVariants(variants: Product[], selection: Record<string, string>): string[] {
  return variants
    .filter((v) => {
      const fixed = variantSelection(v);
      return Object.entries(selection).every(([key, value]) => fixed[key] === value);
    })
    .map((v) => (v as ReadDynamicProduct).id ?? "");
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

/** The YRN the cart's `addItem` expects for a product (verified against the Emporix cart API). */
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
