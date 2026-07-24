---
"@viu/emporix-sdk": patch
---

Fix four facade methods that targeted HTTP paths/methods the live Emporix API
rejects (verified against the tenant). Signatures are unchanged.

- `cart.applyCoupon` / `cart.removeCoupon` used `…/carts/{id}/coupons`, which
  returns 404 "No endpoint". Coupons are applied via the cart **discounts**
  endpoint: `applyCoupon` now `POST …/discounts` (coupon-code payload),
  `removeCoupon` now `DELETE …/discounts?codes=<code>`. Both re-fetch and return
  the updated cart.
- `customer.changePassword` used `PUT …/password` (404). Now `POST …/password/change`.
- `customer.confirmPasswordReset` used `POST …/password/reset/confirm` (404). Now
  `POST …/password/reset/update`.
- `companies.update` / `contacts.update` / `locations.update` used `PATCH`, which
  the customer-management API rejects with 405 Method Not Allowed. Now `PUT`
  (upsert). Send the complete entity, as the server replaces the resource.
