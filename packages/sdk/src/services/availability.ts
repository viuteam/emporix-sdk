import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import { EmporixNotFoundError } from "../core/errors";
import type { AvailabilityWithBundle } from "../generated/availability";

/**
 * Site-aware product availability. Mirrors the Emporix Availability Service
 * `AvailabilityWithBundle` shape (the single-product GET and the batch search
 * both return the bundle-aware variant). There is no restock-date field.
 */
export type Availability = AvailabilityWithBundle;

/** Shared options for {@link AvailabilityService} reads. */
export interface AvailabilityOptions {
  /**
   * When `true`, a product with no availability record resolves to a default
   * `{ available: true }` instead of throwing (single `get`) / being marked
   * unavailable (`getMany`). Off by default — opt in for tenants that sell
   * without stock management.
   */
  defaultAvailableOnNotFound?: boolean;
}

const ANON: AuthContext = { kind: "anonymous" };

/**
 * Reads product availability per site. Default auth is anonymous (like
 * `PriceService.matchByContext`); pass a customer/raw/service context to use a
 * different token. Requires the `availability.availability_view` scope on
 * whichever token is used.
 */
export class AvailabilityService {
  static readonly channel = "availability" as const;
  constructor(private readonly ctx: ClientContext) {}

  /**
   * Single product. Resolves the availability record, or — when
   * `opts.defaultAvailableOnNotFound` is set — a default available record on 404.
   */
  async get(
    productId: string,
    siteCode: string,
    auth: AuthContext = ANON,
    opts: AvailabilityOptions = {},
  ): Promise<Availability> {
    try {
      return await this.ctx.http.request<Availability>({
        method: "GET",
        path: `/availability/${this.ctx.tenant}/availability/${encodeURIComponent(
          productId,
        )}/${encodeURIComponent(siteCode)}`,
        auth,
      });
    } catch (err) {
      if (err instanceof EmporixNotFoundError && opts.defaultAvailableOnNotFound) {
        return { productId, site: siteCode, available: true };
      }
      throw err;
    }
  }

  /**
   * Batch read via `POST .../availability/search` (one request). Products with
   * no availability record are absent from the response; each is synthesized as
   * `{ available: false }` (or `{ available: true }` when
   * `opts.defaultAvailableOnNotFound` is set). The result preserves input order
   * and length. An empty `productIds` resolves to `[]` without a request.
   */
  async getMany(
    productIds: string[],
    siteCode: string,
    auth: AuthContext = ANON,
    opts: AvailabilityOptions = {},
  ): Promise<Availability[]> {
    if (productIds.length === 0) return [];
    const found = await this.ctx.http.request<Availability[]>({
      method: "POST",
      path: `/availability/${this.ctx.tenant}/availability/search`,
      auth,
      query: { site: siteCode, pageSize: productIds.length },
      body: productIds,
      idempotent: true, // pure read over POST — safe to replay on 5xx/429
    });
    const byId = new Map<string, Availability>();
    for (const a of found) if (a.productId) byId.set(a.productId, a);
    return productIds.map(
      (id) =>
        byId.get(id) ?? {
          productId: id,
          site: siteCode,
          available: Boolean(opts.defaultAvailableOnNotFound),
        },
    );
  }
}
