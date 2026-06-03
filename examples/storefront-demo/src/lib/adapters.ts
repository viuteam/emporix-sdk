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

export function productDescription(p: Product): string {
  return pickText((p as ReadProduct).description, "");
}

export function productImages(p: Product): Media[] {
  return (p as ReadProduct).media ?? [];
}

/** Build the `matchByContext` items payload for a set of products. */
export function priceMatchItems(products: Product[]): Array<{ itemId: { itemType: string; id: string } }> {
  return products
    .map((p) => (p as ReadProduct).id)
    .filter((id): id is string => Boolean(id))
    .map((id) => ({ itemId: { itemType: "PRODUCT", id } }));
}

export interface PriceVM {
  amount: number;
  currency: string;
}

type ReadMatch = {
  itemRef?: { id?: string };
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
  const m = (matches as ReadMatch[] | undefined)?.find((x) => x.itemRef?.id === productId);
  if (!m) return undefined;
  const amount = m.effectiveValue ?? m.totalValue;
  if (amount === undefined || !m.currency) return undefined;
  return { amount, currency: m.currency };
}
