import type { ClientContext, PaginatedItems } from "../core/context";
import type { AuthContext } from "../core/auth";
import { EmporixNotFoundError } from "../core/errors";
import type {
  Availability,
  AvailabilityInput,
  AvailabilityCreated,
  AvailabilityBulkInput,
  AvailabilityBulkDeleteInput,
  AvailabilityBulkResult,
} from "./availability-types";

export type {
  Availability,
  AvailabilityInput,
  AvailabilityCreated,
  AvailabilityBulkInput,
  AvailabilityBulkDeleteInput,
  AvailabilityBulkResult,
} from "./availability-types";

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
const SERVICE: AuthContext = { kind: "service" };

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

  /**
   * Lists every availability record for a site (`GET /availability/site/{site}`),
   * wrapped into `PaginatedItems`. Default auth: anonymous.
   */
  async listForSite(
    siteCode: string,
    params: { pageNumber?: number; pageSize?: number; q?: string; sort?: string } = {},
    auth: AuthContext = ANON,
  ): Promise<PaginatedItems<Availability>> {
    const pageNumber = params.pageNumber ?? 1;
    const pageSize = params.pageSize ?? 50;
    const items = await this.ctx.http.request<Availability[]>({
      method: "GET",
      path: `/availability/${this.ctx.tenant}/availability/site/${encodeURIComponent(siteCode)}`,
      query: {
        pageNumber,
        pageSize,
        ...(params.q === undefined ? {} : { q: params.q }),
        ...(params.sort === undefined ? {} : { sort: params.sort }),
      },
      auth,
    });
    return { items, pageNumber, pageSize, hasNextPage: items.length === pageSize };
  }

  // --- Admin writes. Default auth: service. ---

  /**
   * Creates an availability record for a product on a site
   * (`POST /availability/{productId}/{site}`). Responds 409 when the record
   * already exists — use {@link update} to upsert. Default auth: service.
   */
  async create(
    productId: string,
    siteCode: string,
    input: AvailabilityInput,
    auth: AuthContext = SERVICE,
  ): Promise<AvailabilityCreated> {
    return this.ctx.http.request<AvailabilityCreated>({
      method: "POST",
      path: `/availability/${this.ctx.tenant}/availability/${encodeURIComponent(
        productId,
      )}/${encodeURIComponent(siteCode)}`,
      body: input,
      auth,
    });
  }

  /**
   * Upserts a product's availability on a site
   * (`PUT /availability/{productId}/{site}`). Returns the created record's id
   * on 201 and nothing on 204. This endpoint has no PATCH counterpart.
   * Default auth: service.
   */
  async update(
    productId: string,
    siteCode: string,
    input: AvailabilityInput,
    auth: AuthContext = SERVICE,
  ): Promise<AvailabilityCreated | void> {
    return this.ctx.http.request<AvailabilityCreated | void>({
      method: "PUT",
      path: `/availability/${this.ctx.tenant}/availability/${encodeURIComponent(
        productId,
      )}/${encodeURIComponent(siteCode)}`,
      body: input,
      auth,
    });
  }

  /**
   * Deletes a product's availability on a site
   * (`DELETE /availability/{productId}/{site}`). Default auth: service.
   */
  async delete(productId: string, siteCode: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `/availability/${this.ctx.tenant}/availability/${encodeURIComponent(
        productId,
      )}/${encodeURIComponent(siteCode)}`,
      auth,
    });
  }
}
