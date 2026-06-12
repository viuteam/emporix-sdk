import type { ClientContext, PaginatedItems } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  Fee,
  ItemFee,
  FeeDraft,
  ItemFeeDraft,
  ItemFeeSearch,
  ListFeesQuery,
  SetItemFeesOptions,
} from "./fee-types";

export type {
  Fee,
  ItemFee,
  FeeDraft,
  ItemFeeDraft,
  ItemFeeSearch,
  ListFeesQuery,
  SetItemFeesOptions,
} from "./fee-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix Fee Service (`/fee/{tenant}/…`): fee definitions plus the
 * item/product mappings that attach them. Writes require a backend-only scope
 * (`fee.fee_*` / `fee.item_*`); GETs need a token but no scope. Default auth:
 * service. Server-side use only — the service token must never reach a browser.
 *
 * Quirks (server behavior, not handled here): a payment-type fee's `code` must
 * equal the payment-mode code or the fee is silently ignored; a wrong/missing
 * `siteCode` filters to an empty array rather than erroring; an expired
 * `activeTimespan` silently disables the fee; `setItemFees`/`setProductFees`
 * replace the whole mapping unless `partial` is set.
 */
export class FeeService {
  static readonly channel = "fee" as const;
  constructor(private readonly ctx: ClientContext) {}

  private feesBase(): string {
    return `/fee/${this.ctx.tenant}/fees`;
  }

  private itemFeesBase(): string {
    return `/fee/${this.ctx.tenant}/itemFees`;
  }

  private productFeesBase(): string {
    return `/fee/${this.ctx.tenant}/productFees`;
  }

  // --- Fee definitions ---

  /**
   * List fee definitions, wrapped in the shared {@link PaginatedItems}
   * envelope (same heuristic as `media.list`: `hasNextPage` is true when the
   * returned page is full). Defaults match Emporix server defaults
   * (`pageNumber: 1`, `pageSize: 60`).
   */
  async list(query: ListFeesQuery = {}, auth: AuthContext = SERVICE): Promise<PaginatedItems<Fee>> {
    const pageNumber = query.pageNumber ?? 1;
    const pageSize = query.pageSize ?? 60;
    const items = await this.ctx.http.request<Fee[]>({
      method: "GET",
      path: this.feesBase(),
      auth,
      query: { ...query, pageNumber, pageSize },
    });
    return { items, pageNumber, pageSize, hasNextPage: items.length === pageSize };
  }

  /** Retrieve one fee definition by id. */
  async get(id: string, auth: AuthContext = SERVICE): Promise<Fee> {
    return this.ctx.http.request<Fee>({
      method: "GET",
      path: `${this.feesBase()}/${encodeURIComponent(id)}`,
      auth,
    });
  }

  /** Create a fee definition. */
  async create(draft: FeeDraft, auth: AuthContext = SERVICE): Promise<Fee> {
    return this.ctx.http.request<Fee>({
      method: "POST",
      path: this.feesBase(),
      auth,
      body: draft,
    });
  }

  /** Update a fee definition by id. */
  async update(id: string, draft: FeeDraft, auth: AuthContext = SERVICE): Promise<Fee> {
    return this.ctx.http.request<Fee>({
      method: "PUT",
      path: `${this.feesBase()}/${encodeURIComponent(id)}`,
      auth,
      body: draft,
    });
  }

  /** Delete a fee definition by id. */
  async delete(id: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.feesBase()}/${encodeURIComponent(id)}`,
      auth,
    });
  }

  // --- Item-fee mappings ---

  /** List all item-fee mappings. */
  async listItemFees(auth: AuthContext = SERVICE): Promise<ItemFee[]> {
    return this.ctx.http.request<ItemFee[]>({
      method: "GET",
      path: this.itemFeesBase(),
      auth,
    });
  }

  /** Fee mappings for one item YRN. */
  async getItemFees(itemYrn: string, auth: AuthContext = SERVICE): Promise<ItemFee[]> {
    return this.ctx.http.request<ItemFee[]>({
      method: "GET",
      path: `${this.itemFeesBase()}/${encodeURIComponent(itemYrn)}/fees`,
      auth,
    });
  }

  /** Create an item-fee mapping. */
  async createItemFee(draft: ItemFeeDraft, auth: AuthContext = SERVICE): Promise<ItemFee> {
    return this.ctx.http.request<ItemFee>({
      method: "POST",
      path: this.itemFeesBase(),
      auth,
      body: draft,
    });
  }

  /**
   * Set the fee list for an item YRN. Destructive replace by default; pass
   * `{ partial: true }` to merge (`?partial=true`).
   */
  async setItemFees(
    itemYrn: string,
    feeIds: string[],
    opts: SetItemFeesOptions = {},
    auth: AuthContext = SERVICE,
  ): Promise<ItemFee> {
    return this.ctx.http.request<ItemFee>({
      method: "PUT",
      path: `${this.itemFeesBase()}/${encodeURIComponent(itemYrn)}/fees`,
      auth,
      body: { feeIds },
      ...(opts.partial ? { query: { partial: "true" } } : {}),
    });
  }

  /**
   * Delete item-fee mappings for a YRN. Without `feeId`, removes all mappings
   * for the YRN; with `feeId`, removes that single fee from the mapping.
   */
  async deleteItemFees(itemYrn: string, feeId?: string, auth: AuthContext = SERVICE): Promise<void> {
    const base = `${this.itemFeesBase()}/${encodeURIComponent(itemYrn)}/fees`;
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: feeId ? `${base}/${encodeURIComponent(feeId)}` : base,
      auth,
    });
  }

  /** Search item-fee mappings by item YRNs + site. */
  async searchItemFees(search: ItemFeeSearch, auth: AuthContext = SERVICE): Promise<ItemFee[]> {
    return this.ctx.http.request<ItemFee[]>({
      method: "POST",
      path: `${this.itemFeesBase()}/search`,
      auth,
      body: search,
    });
  }

  // --- Product-fee mappings ---

  /** Fee mappings for a product id. */
  async getProductFees(productId: string, auth: AuthContext = SERVICE): Promise<ItemFee[]> {
    return this.ctx.http.request<ItemFee[]>({
      method: "GET",
      path: `${this.productFeesBase()}/${encodeURIComponent(productId)}/fees`,
      auth,
    });
  }

  /**
   * Set the fee list for a product id. Destructive replace by default; pass
   * `{ partial: true }` to merge (`?partial=true`).
   */
  async setProductFees(
    productId: string,
    feeIds: string[],
    opts: SetItemFeesOptions = {},
    auth: AuthContext = SERVICE,
  ): Promise<ItemFee> {
    return this.ctx.http.request<ItemFee>({
      method: "PUT",
      path: `${this.productFeesBase()}/${encodeURIComponent(productId)}/fees`,
      auth,
      body: { feeIds },
      ...(opts.partial ? { query: { partial: "true" } } : {}),
    });
  }

  /** Delete all fee mappings for a product id. */
  async deleteProductFees(productId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.productFeesBase()}/${encodeURIComponent(productId)}/fees`,
      auth,
    });
  }
}
