# Coupon Service

Bindings for the Emporix **Coupon Service** (`/coupon/{tenant}/…`): coupon CRUD,
validation, redemptions, and referral coupons.

> **Mixed audience.** Admin CRUD requires the `coupon.coupon_manage` scope
> (service token). Validation / redemption / referral can be customer-driven
> (`coupon.coupon_redeem`) or on-behalf (`coupon.coupon_redeem_on_behalf`).
> Every SDK method defaults to the **service token**; pass `auth.customer(token)`
> for customer-driven calls. Never expose the service token to a browser — use
> the React hooks (below) for storefront validate/redeem.

## Admin CRUD — `client.coupons` (server-side)

```ts
const list = await client.coupons.listCoupons({ pageSize: 20 }); // plain array

const c = await client.coupons.getCoupon("SUMMER");

// create — `name` is required; `code` is auto-generated if omitted.
// Returns the created resource's location ({ id?, yrn? }), not the coupon.
const { id } = await client.coupons.createCoupon({
  code: "SUMMER",
  name: "Summer sale",
  discountType: "PERCENT",
  discountPercentage: 10,
});

// update / patch resolve once accepted (no response body)
await client.coupons.updateCoupon("SUMMER", { name: "Summer sale 2026", discountType: "PERCENT", discountPercentage: 15 });
await client.coupons.patchCoupon("SUMMER", { name: "Renamed" });

await client.coupons.deleteCoupon("SUMMER");
```

## Validation & redemption

A redemption body requires `orderTotal` and `discount` (and optionally
`orderCode` / `customerNumber` / `legalEntityId`).

```ts
const redemption = {
  orderCode: "O-1001",
  orderTotal: { amount: 100, currency: "EUR" },
  discount: { amount: 10, currency: "EUR" },
};

// resolves if redeemable, throws otherwise
await client.coupons.validateCoupon("SUMMER", redemption, auth.customer(token));

// redeem → 201 with the created redemption's location ({ id?, yrn? })
const created = await client.coupons.redeemCoupon("SUMMER", redemption, auth.customer(token));

const redemptions = await client.coupons.listRedemptions("SUMMER");
const one = await client.coupons.getRedemption("SUMMER", "r1");
await client.coupons.deleteRedemption("SUMMER", "r1");
```

`customerNumber` in a redemption body is only honored with the
`coupon.coupon_redeem_on_behalf` scope.

## Referral coupons

```ts
const ref = await client.coupons.getReferralCoupon("C0123456789");
await client.coupons.createReferralCoupon("C0123456789"); // no request body
```

## React hooks (storefront)

```tsx
import { useValidateCoupon, useRedeemCoupon } from "@viu/emporix-sdk-react";

const validate = useValidateCoupon();
const redeem = useRedeemCoupon();

const redemption = {
  orderCode: cart.id,
  orderTotal: { amount: cart.totalPrice, currency: cart.currency },
  discount: { amount: 10, currency: cart.currency },
};

await validate.mutateAsync({ code: "SUMMER", redemption });
if (validate.isSuccess) {
  await redeem.mutateAsync({ code: "SUMMER", redemption });
}
```

Both hooks use the browser auth context (customer if logged in, else anonymous)
— never the service token.
