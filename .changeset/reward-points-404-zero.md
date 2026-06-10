---
"@viu/emporix-sdk": patch
---

Fix the reward-points balance/summary erroring for customers who have no points. `GET /reward-points/public/customer` (and `…/customer/summary`) is the correct Emporix endpoint, but it answers `404 "No reward points found"` for a signed-in customer who has never earned points — i.e. every customer without a completed order. `rewardPoints.getMyPoints` now maps that 404 to `0`, and `getMySummary` to an empty summary (`{ activePoints: 0, summary: { addedPointsList: [] } }`), so `useMyRewardPoints` / `useMyRewardPointsSummary` resolve cleanly instead of throwing. The admin lookups (`getCustomerPoints` / `getCustomerSummary`) still surface 404s, where a missing customer is a real error.
