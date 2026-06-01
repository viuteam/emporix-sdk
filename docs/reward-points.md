# Reward Points Service

Bindings for the Emporix **Reward Points Service** (`/reward-points/…`): admin
customer-points management, the signed-in customer's own points, and redeem
options. Redeeming points issues a **coupon code**.

> **Per-group auth.** Admin endpoints and redeem-option management use the
> **service token**. The `/public/*` ("my points") methods accept only a
> **customer token** — pass `auth.customer(token)` (the React hooks do this).
> Redeem-option **reads** work with either.
>
> **Path quirk:** customer/public endpoints have no tenant segment
> (`/reward-points/customer/{id}`); redeem options are tenant-scoped
> (`/reward-points/{tenant}/redeemOptions`). The SDK handles this for you.
>
> A point **balance** (`getCustomerPoints` / `getMyPoints`) is returned as a
> bare `number`; the **summary** endpoints return a detailed object.

## Admin (server-side)

```ts
const batch = await client.rewardPoints.listAllSummaries(); // PointsSummary[]
const balance = await client.rewardPoints.getCustomerPoints("C0123"); // number
const summary = await client.rewardPoints.getCustomerSummary("C0123");
await client.rewardPoints.createCustomerPoints("C0123", { points: 100 });
await client.rewardPoints.addPoints("C0123", { points: 50 });
await client.rewardPoints.redeemPoints("C0123", { points: 20 });
await client.rewardPoints.deleteCustomerPoints("C0123");
```

## My points (storefront — customer token)

```ts
const balance = await client.rewardPoints.getMyPoints(auth.customer(token)); // number
const mySummary = await client.rewardPoints.getMySummary(auth.customer(token));

// redeem points for a coupon code
const { code } = await client.rewardPoints.redeemMyPoints(
  { redeemOptionId: "opt-1" },
  auth.customer(token),
);
```

## Redeem options

`createRedeemOption` returns the updated options list; `updateRedeemOption`
resolves once accepted (no body).

```ts
const options = await client.rewardPoints.listRedeemOptions();
const updated = await client.rewardPoints.createRedeemOption({ type: "coupon", points: 100, name: "10% off" });
await client.rewardPoints.updateRedeemOption("opt-1", { points: 150 });
await client.rewardPoints.deleteRedeemOption("opt-1");
```

## React hooks (storefront)

```tsx
import {
  useMyRewardPoints,
  useMyRewardPointsSummary,
  useRedeemOptions,
  useRedeemRewardPoints,
} from "@viu/emporix-sdk-react";

const { data: balance } = useMyRewardPoints();        // number, customer-only
const { data: summary } = useMyRewardPointsSummary();  // customer-only
const { data: options } = useRedeemOptions();          // guest or customer
const redeem = useRedeemRewardPoints();

const { code } = await redeem.mutateAsync({ redeemOptionId: "opt-1" });
```

`useMyRewardPoints` / `useMyRewardPointsSummary` / `useRedeemRewardPoints`
require a logged-in customer (they throw without a stored token).
