import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  CouponList,
  Coupon,
  CouponInput,
  CouponUpdate,
  CouponCreated,
  Redemption,
  RedemptionInput,
  RedemptionCreated,
  ReferralCoupon,
} from "./coupon-types";

export type {
  Coupon,
  CouponList,
  CouponInput,
  CouponUpdate,
  CouponCreated,
  Redemption,
  RedemptionInput,
  RedemptionCreated,
  ReferralCoupon,
} from "./coupon-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix Coupon Service (`/coupon/{tenant}/…`): coupon CRUD, validation,
 * redemptions, and referral coupons.
 *
 * Every method defaults to the **service (clientCredentials) token**. For
 * customer-driven validation/redemption, pass `auth.customer(token)` as the
 * trailing argument (the React hooks do this with the browser context). The
 * service token must never reach a browser.
 */
export class CouponService {
  static readonly channel = "coupon" as const;
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/coupon/${this.ctx.tenant}`;
  }

  /** List coupons by criteria. Returns a plain array. */
  async listCoupons(
    query: Record<string, string | number> = {},
    auth: AuthContext = SERVICE,
  ): Promise<CouponList> {
    return this.ctx.http.request<CouponList>({
      method: "GET",
      path: `${this.base()}/coupons`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve one coupon by code. */
  async getCoupon(code: string, auth: AuthContext = SERVICE): Promise<Coupon> {
    return this.ctx.http.request<Coupon>({
      method: "GET",
      path: `${this.base()}/coupons/${encodeURIComponent(code)}`,
      auth,
    });
  }

  /** Create a coupon (`POST`, HTTP 201). Returns the created resource's `{ id?, yrn? }`. */
  async createCoupon(input: CouponInput, auth: AuthContext = SERVICE): Promise<CouponCreated> {
    return this.ctx.http.request<CouponCreated>({
      method: "POST",
      path: `${this.base()}/coupons`,
      auth,
      body: input,
    });
  }

  /** Replace a coupon by code (`PUT`). Resolves once the update is accepted. */
  async updateCoupon(code: string, input: CouponUpdate, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `${this.base()}/coupons/${encodeURIComponent(code)}`,
      auth,
      body: input,
    });
  }

  /** Partially update a coupon by code (`PATCH` merge body). */
  async patchCoupon(code: string, patch: CouponUpdate, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PATCH",
      path: `${this.base()}/coupons/${encodeURIComponent(code)}`,
      auth,
      body: patch,
    });
  }

  /** Delete a coupon by code. */
  async deleteCoupon(code: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/coupons/${encodeURIComponent(code)}`,
      auth,
    });
  }

  /**
   * Check whether a coupon can be redeemed (`POST /validation`). Resolves when
   * redeemable; throws an `EmporixError` otherwise (no response body).
   */
  async validateCoupon(
    code: string,
    redemption: RedemptionInput,
    auth: AuthContext = SERVICE,
  ): Promise<void> {
    await this.ctx.http.request<void>({
      method: "POST",
      path: `${this.base()}/coupons/${encodeURIComponent(code)}/validation`,
      auth,
      body: redemption,
    });
  }

  /** List a coupon's redemptions by criteria. */
  async listRedemptions(
    code: string,
    query: Record<string, string | number> = {},
    auth: AuthContext = SERVICE,
  ): Promise<Redemption[]> {
    return this.ctx.http.request<Redemption[]>({
      method: "GET",
      path: `${this.base()}/coupons/${encodeURIComponent(code)}/redemptions`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Redeem a coupon by creating a redemption (`POST`, HTTP 201). Returns the resource location. */
  async redeemCoupon(
    code: string,
    redemption: RedemptionInput,
    auth: AuthContext = SERVICE,
  ): Promise<RedemptionCreated> {
    return this.ctx.http.request<RedemptionCreated>({
      method: "POST",
      path: `${this.base()}/coupons/${encodeURIComponent(code)}/redemptions`,
      auth,
      body: redemption,
    });
  }

  /** Retrieve one redemption by id. */
  async getRedemption(code: string, id: string, auth: AuthContext = SERVICE): Promise<Redemption> {
    return this.ctx.http.request<Redemption>({
      method: "GET",
      path: `${this.base()}/coupons/${encodeURIComponent(code)}/redemptions/${encodeURIComponent(id)}`,
      auth,
    });
  }

  /** Delete a redemption by id. */
  async deleteRedemption(code: string, id: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/coupons/${encodeURIComponent(code)}/redemptions/${encodeURIComponent(id)}`,
      auth,
    });
  }

  /** Retrieve a customer's referral coupon (resolves to an empty body when none exists). */
  async getReferralCoupon(customerNumber: string, auth: AuthContext = SERVICE): Promise<ReferralCoupon> {
    return this.ctx.http.request<ReferralCoupon>({
      method: "GET",
      path: `${this.base()}/referral-coupons/${encodeURIComponent(customerNumber)}`,
      auth,
    });
  }

  /** Create a referral coupon code for a customer (no request body). */
  async createReferralCoupon(
    customerNumber: string,
    auth: AuthContext = SERVICE,
  ): Promise<ReferralCoupon> {
    return this.ctx.http.request<ReferralCoupon>({
      method: "POST",
      path: `${this.base()}/referral-coupons/${encodeURIComponent(customerNumber)}`,
      auth,
    });
  }
}
