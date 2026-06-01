---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add Emporix Coupon Service bindings via `client.coupons`: coupon CRUD
(`listCoupons`, `getCoupon`, `createCoupon`, `updateCoupon`, `patchCoupon`,
`deleteCoupon`), validation (`validateCoupon`), redemptions (`listRedemptions`,
`redeemCoupon`, `getRedemption`, `deleteRedemption`), and referral coupons
(`getReferralCoupon`, `createReferralCoupon`). Methods default to the service
token and are auth-overridable. Adds React hooks `useValidateCoupon` and
`useRedeemCoupon` for storefront validate/redeem (browser auth context).
