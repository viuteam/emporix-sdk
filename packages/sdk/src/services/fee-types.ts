import type { Fee as GenFee, ItemFee as GenItemFee } from "../generated/fee";

/** A fee definition as returned by the API (`id`/`yrn` server-assigned). */
export type Fee = GenFee;

/** An item-fee (or product-fee) mapping as returned by the API. */
export type ItemFee = GenItemFee;

/**
 * Body for create/update of a fee definition — {@link Fee} minus the
 * server-assigned `id`/`yrn`. (The upstream spec reuses the `Fee` schema as the
 * request body; the SDK exposes this narrower draft type.)
 */
export type FeeDraft = Omit<Fee, "id" | "yrn">;

/** Body for `POST /itemFees` — {@link ItemFee} minus the server `id`. */
export type ItemFeeDraft = Omit<ItemFee, "id">;

/** Body of `POST /itemFees/search`. */
export interface ItemFeeSearch {
  itemYrns: string[];
  siteCode: string;
}

/**
 * Body of `POST /itemFees/searchByProductId` — one product, several sites.
 *
 * **Note:** this and {@link ItemFeeSearchByProductIds} are asymmetric in the
 * upstream spec (singular here takes `siteCodes: string[]`, plural takes a
 * single `siteCode` and a comma-joined `productIds` **string**). The SDK mirrors
 * the schema verbatim rather than normalizing it.
 */
export interface ItemFeeSearchByProductId {
  productId: string;
  siteCodes: string[];
  pageNumber?: number;
  pageSize?: number;
}

/**
 * Body of `POST /itemFees/searchByProductIds` — several products, one site.
 * `productIds` is a **single string** (comma-separated), not an array — see the
 * note on {@link ItemFeeSearchByProductId}.
 */
export interface ItemFeeSearchByProductIds {
  productIds: string;
  siteCode: string;
  pageNumber?: number;
  pageSize?: number;
}

/**
 * Query for the paginated `GET /fees` list. Explicit fields are typed for
 * autocomplete; the index signature stays open so Emporix `q`-syntax filters
 * pass through verbatim (mirrors `ListAssetsQuery` in `media`).
 */
export interface ListFeesQuery {
  pageNumber?: number;
  pageSize?: number;
  /** Emporix sort syntax, e.g. `"code:asc"`. */
  sort?: string;
  /** Emporix `q`-syntax filter, e.g. `"siteCode:main"`. */
  q?: string;
  [key: string]: string | number | undefined;
}

/** Options for {@link FeeService.setItemFees} / {@link FeeService.setProductFees}. */
export interface SetItemFeesOptions {
  /** When true, merges instead of replacing (serialized to `?partial=true`). */
  partial?: boolean;
}
