import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import { EmporixNotFoundError } from "../core/errors";
import type {
  CustomerSummaryBatch,
  PointsSummary,
  NewPointsEntry,
  AddedPoints,
  RedeemedPoints,
  RedeemOption,
  RedeemOptionList,
  RedeemMyPointsInput,
  RedeemCouponResult,
} from "./reward-points-types";

export type {
  CustomerSummaryBatch,
  PointsSummary,
  NewPointsEntry,
  AddedPoints,
  RedeemedPoints,
  RedeemOption,
  RedeemOptionList,
  RedeemMyPointsInput,
  RedeemCouponResult,
} from "./reward-points-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix Reward Points Service (`/reward-points/…`): admin customer-points
 * management, the signed-in customer's own points, and redeem options.
 *
 * Auth differs per group: admin and redeem-option management default to the
 * **service token**; the `/public/*` methods require a **customer token** (they
 * accept only `CustomerAccessToken`). Note the mixed base paths — customer/
 * public/batch endpoints omit `{tenant}`, redeem options include it. A point
 * balance (`getCustomerPoints` / `getMyPoints`) is returned as a bare `number`.
 */
export class RewardPointsService {
  static readonly channel = "reward-points" as const;
  constructor(private readonly ctx: ClientContext) {}

  /** Base without tenant (customer / public / batch endpoints). */
  private base(): string {
    return `/reward-points`;
  }

  /** Tenant-scoped base (redeem options only). */
  private tenantBase(): string {
    return `/reward-points/${this.ctx.tenant}`;
  }

  // --- Admin: customer points management (service token) ---

  /** Batch summary across all customers. */
  async listAllSummaries(
    query: Record<string, string | number> = {},
    auth: AuthContext = SERVICE,
  ): Promise<CustomerSummaryBatch> {
    return this.ctx.http.request<CustomerSummaryBatch>({
      method: "GET",
      path: `${this.base()}/summaryBatch`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve one customer's reward-points balance. */
  async getCustomerPoints(customerId: string, auth: AuthContext = SERVICE): Promise<number> {
    return this.ctx.http.request<number>({
      method: "GET",
      path: `${this.base()}/customer/${encodeURIComponent(customerId)}`,
      auth,
    });
  }

  /** Create a reward-points entry for a customer. */
  async createCustomerPoints(
    customerId: string,
    input: NewPointsEntry,
    auth: AuthContext = SERVICE,
  ): Promise<void> {
    await this.ctx.http.request<void>({
      method: "POST",
      path: `${this.base()}/customer/${encodeURIComponent(customerId)}`,
      auth,
      body: input,
    });
  }

  /** Delete a customer's reward points. */
  async deleteCustomerPoints(customerId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/customer/${encodeURIComponent(customerId)}`,
      auth,
    });
  }

  /** Retrieve a reward-points summary for one customer. */
  async getCustomerSummary(customerId: string, auth: AuthContext = SERVICE): Promise<PointsSummary> {
    return this.ctx.http.request<PointsSummary>({
      method: "GET",
      path: `${this.base()}/customer/${encodeURIComponent(customerId)}/summary`,
      auth,
    });
  }

  /** Add reward points for a customer. */
  async addPoints(customerId: string, input: AddedPoints, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "POST",
      path: `${this.base()}/customer/${encodeURIComponent(customerId)}/addPoints`,
      auth,
      body: input,
    });
  }

  /** Redeem a customer's reward points (on behalf). */
  async redeemPoints(customerId: string, input: RedeemedPoints, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "POST",
      path: `${this.base()}/customer/${encodeURIComponent(customerId)}/redeemPoints`,
      auth,
      body: input,
    });
  }

  // --- Storefront: the signed-in customer's own points (customer token required) ---

  /** The signed-in customer's reward-points balance. Requires a customer `auth`. */
  async getMyPoints(auth: AuthContext): Promise<number> {
    // A customer who has never earned points has no entry, and Emporix answers
    // 404 "No reward points found" — for the signed-in customer that simply
    // means zero points, so map it to 0 rather than surfacing an error.
    try {
      return await this.ctx.http.request<number>({
        method: "GET",
        path: `${this.base()}/public/customer`,
        auth,
      });
    } catch (err) {
      if (err instanceof EmporixNotFoundError) return 0;
      throw err;
    }
  }

  /** The signed-in customer's reward-points summary. Requires a customer `auth`. */
  async getMySummary(auth: AuthContext): Promise<PointsSummary> {
    // Same as getMyPoints: a 404 means the signed-in customer has no entry yet,
    // i.e. an empty summary (zero active points, no history), not an error.
    try {
      return await this.ctx.http.request<PointsSummary>({
        method: "GET",
        path: `${this.base()}/public/customer/summary`,
        auth,
      });
    } catch (err) {
      if (err instanceof EmporixNotFoundError) {
        return { activePoints: 0, summary: { addedPointsList: [] } };
      }
      throw err;
    }
  }

  /**
   * Redeem the signed-in customer's points for a coupon code. Requires a
   * customer `auth`. Returns the issued coupon `{ code }`.
   */
  async redeemMyPoints(input: RedeemMyPointsInput, auth: AuthContext): Promise<RedeemCouponResult> {
    return this.ctx.http.request<RedeemCouponResult>({
      method: "POST",
      path: `${this.base()}/public/customer/redeem`,
      auth,
      body: input,
    });
  }

  // --- Redeem options (tenant-scoped; read open to customer, management service-only) ---

  /** List redeem options. Defaults to the service token; pass a customer `auth` for storefront reads. */
  async listRedeemOptions(auth: AuthContext = SERVICE): Promise<RedeemOptionList> {
    return this.ctx.http.request<RedeemOptionList>({
      method: "GET",
      path: `${this.tenantBase()}/redeemOptions`,
      auth,
    });
  }

  /** Create a redeem option. Returns the updated options list. */
  async createRedeemOption(input: RedeemOption, auth: AuthContext = SERVICE): Promise<RedeemOptionList> {
    return this.ctx.http.request<RedeemOptionList>({
      method: "POST",
      path: `${this.tenantBase()}/redeemOptions`,
      auth,
      body: input,
    });
  }

  /** Update a redeem option by id. Resolves once accepted (no response body). */
  async updateRedeemOption(
    redeemOptionId: string,
    input: RedeemOption,
    auth: AuthContext = SERVICE,
  ): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `${this.tenantBase()}/redeemOptions/${encodeURIComponent(redeemOptionId)}`,
      auth,
      body: input,
    });
  }

  /** Delete a redeem option by id. */
  async deleteRedeemOption(redeemOptionId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.tenantBase()}/redeemOptions/${encodeURIComponent(redeemOptionId)}`,
      auth,
    });
  }
}
