# Coupon Service Binding — Design Spec

**Date:** 2026-06-01
**Status:** Approved (design)
**Packages:** `@viu/emporix-sdk` (core) + `@viu/emporix-sdk-react` (validate/redeem hooks)

## Summary

Bind the Emporix **Coupon Service** (`/coupon/{tenant}/…`) into the SDK as a
single service, `client.coupons`, covering coupon CRUD, validation, redemptions,
and referral coupons (all 13 upstream operations). Add two React hooks for the
customer-facing flows — `useValidateCoupon` and `useRedeemCoupon`. Follows the
established admin-service "configuration pattern" for the core service.

## Background

The Coupon Service is a mixed-audience API: admin CRUD requires
`coupon.coupon_manage`, while validation / redemption / referral support
customer-driven use via `coupon.coupon_redeem` ("current user") and
`coupon.coupon_redeem_on_behalf` (act for another `customerNumber`). All tokens
are OAuth2; the SDK distinguishes them via its `AuthContext`
(`service` / `customer` / `anonymous` / `raw`).

## Design decisions

- **D1 — Scope:** Full. All 13 operations are bound. (User-selected "Voll".)
- **D2 — One service:** A single `CouponService` exposed as `client.coupons`,
  base path `/coupon/{tenant}`.
- **D3 — Auth default = service, overridable:** Every method defaults `auth` to
  `{ kind: "service" }`; the caller passes `auth.customer(token)` (or the React
  hook injects the browser context) for customer-driven validate/redeem.
  (User-selected.)
- **D4 — React hooks for validate/redeem:** `useValidateCoupon` and
  `useRedeemCoupon` are added to `@viu/emporix-sdk-react`. They resolve auth via
  the existing `useReadAuth()` helper (customer if logged in, else anonymous) and
  pass it as the `auth` override — the service token never reaches the browser.
  (User-selected; this is the first service besides Shopping List to get hooks.)
- **D5 — Types via codegen:** Add `coupon` to `fetch-specs.ts`; generate
  `src/generated/coupon/`. A thin `src/services/coupon-types.ts` re-exports
  stable public names. Real generated names pinned in codegen (Task 1). Upstream
  `components.schemas` keys observed: `coupon`, `couponList`, `createCouponBody`,
  `updateCouponBody`, `partial`, `redemption`, `redemption-creation`,
  `redemptionList`, `resource-location`, `referralCoupon`.
- **D6 — Response-shape quirks (verify in codegen):**
  - `validateCoupon` → **200 with no body**; resolves to `void` (redeemable) or
    throws `EmporixError` (not redeemable / 404 / 409).
  - `redeemCoupon` → **201 `resource-location`** (the created redemption's
    location/id), not the full redemption object.
  - `PATCH /coupons/{code}` body shape (`partial`) — confirm merge-object vs
    op-array during codegen; default to a partial `CouponUpdate` merge body.
  - `customerNumber` in a redemption body is only honored with the
    `coupon_redeem_on_behalf` scope (documented, not enforced client-side).

## Public types (final names pinned in codegen)

`Coupon` (read), `CouponList` (list response), `CouponInput` (create),
`CouponUpdate` (PUT/PATCH body), `Redemption` (read), `RedemptionInput`
(`redemption-creation`: `orderCode?`, `customerNumber?`, `legalEntityId?`, …),
`RedemptionCreated` (`resource-location`), `ReferralCoupon`.

## Service surface (`client.coupons`)

| Method | HTTP | Path | Returns |
|---|---|---|---|
| `listCoupons(query?, auth?)` | GET | `/coupons` | `CouponList` |
| `getCoupon(code, auth?)` | GET | `/coupons/{code}` | `Coupon` |
| `createCoupon(input, auth?)` | POST | `/coupons` | `Coupon` \| `{ code }` |
| `updateCoupon(code, input, auth?)` | PUT | `/coupons/{code}` | `Coupon` \| `void` |
| `patchCoupon(code, patch, auth?)` | PATCH | `/coupons/{code}` | `Coupon` \| `void` |
| `deleteCoupon(code, auth?)` | DELETE | `/coupons/{code}` | `void` |
| `validateCoupon(code, redemption, auth?)` | POST | `/coupons/{code}/validation` | `void` |
| `listRedemptions(code, query?, auth?)` | GET | `/coupons/{code}/redemptions` | `Redemption[]` |
| `redeemCoupon(code, redemption, auth?)` | POST | `/coupons/{code}/redemptions` | `RedemptionCreated` |
| `getRedemption(code, id, auth?)` | GET | `/coupons/{code}/redemptions/{id}` | `Redemption` |
| `deleteRedemption(code, id, auth?)` | DELETE | `/coupons/{code}/redemptions/{id}` | `void` |
| `getReferralCoupon(customerNumber, auth?)` | GET | `/referral-coupons/{customerNumber}` | `ReferralCoupon` |
| `createReferralCoupon(customerNumber, body?, auth?)` | POST | `/referral-coupons/{customerNumber}` | `ReferralCoupon` \| `{ code }` |

All path segments (`code`, `id`, `customerNumber`) are `encodeURIComponent`-escaped.

## React hooks (`@viu/emporix-sdk-react`)

- `useValidateCoupon()` → mutation `({ code, redemption }) => client.coupons.validateCoupon(code, redemption, ctx)`.
  `onSuccess` = redeemable; `onError` = not redeemable. No cache invalidation.
- `useRedeemCoupon()` → mutation `({ code, redemption }) => client.coupons.redeemCoupon(code, redemption, ctx)`.
  `ctx = useReadAuth().ctx`. Invalidate `["emporix", "coupons"]` on success.

No coupon *read* hooks (admin CRUD stays server-side via the core SDK).

## Error handling

Reuses the SDK's shared `errorFromResponse` mapping via `HttpClient`. No
service-specific error types. `validateCoupon` surfaces non-redeemability as a
thrown `EmporixError`.

## Testing

- **Core (Vitest + MSW):** `coupon-types.test.ts`, `coupon.test.ts` (each method:
  `Bearer svc-tok`, paths, bodies, the no-body validation, the 201
  resource-location redeem, `encodeURIComponent`, 404 → error), `coupon-wiring.test.ts`.
- **React (Vitest + jsdom):** `use-coupons.test.tsx` — `useValidateCoupon` and
  `useRedeemCoupon` call the client with the browser auth context and surface
  success/error.

## Out of scope

Nothing within the Coupon Service is deferred. No admin/read React hooks.

## Deliverables

Codegen + `coupon-types.ts` + `CouponService` + client wiring (logger `"coupon"`,
facade `src/coupon.ts`, barrel) + React hooks + `docs/coupon.md` + `docs/react.md`
mention + changeset (minor for **both** `@viu/emporix-sdk` and
`@viu/emporix-sdk-react`). Branch `feat/coupon-service` off `main`, created at
execution time.
