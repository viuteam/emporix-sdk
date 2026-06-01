---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add Emporix Reward Points Service bindings via `client.rewardPoints`: admin
customer-points management (`listAllSummaries`, `getCustomerPoints`,
`createCustomerPoints`, `deleteCustomerPoints`, `getCustomerSummary`,
`addPoints`, `redeemPoints`), the signed-in customer's own points
(`getMyPoints`, `getMySummary`, `redeemMyPoints` → coupon code), and redeem
options (`listRedeemOptions`, `createRedeemOption`, `updateRedeemOption`,
`deleteRedeemOption`). Admin methods default to the service token; the
`/public/*` methods require a customer token. Adds React hooks
`useMyRewardPoints`, `useMyRewardPointsSummary`, `useRedeemRewardPoints` and
`useRedeemOptions`.
