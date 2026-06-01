# Reward Points Service Binding — Design Spec

**Date:** 2026-06-01
**Status:** Approved (design)
**Packages:** `@viu/emporix-sdk` (core) + `@viu/emporix-sdk-react` (storefront hooks)

## Summary

Bind the Emporix **Reward Points Service** (`/reward-points/…`) as a single
service, `client.rewardPoints`, covering admin customer-points management, the
signed-in customer's own points ("my points"), and redeem options (all 14
operations). Add four React hooks for the storefront flows. Redeeming points
yields a **coupon code** (ties into the Coupon Service).

## Background

The Reward Points Service is mixed-audience with **explicit per-endpoint auth**:
admin endpoints accept only OAuth2 (service token); the `/public/*` endpoints
accept only `CustomerAccessToken`; redeem-options accept both. Public-types
alias the generated types (the tax/coupon precedent).

## Design decisions

- **D1 — Scope:** Full. All 14 operations bound. (User-selected.)
- **D2 — One service:** `RewardPointsService` → `client.rewardPoints`.
- **D3 — Per-group auth:** Admin + redeem-option-management default to the
  **service token**; redeem-options list defaults service but is overridable;
  the three `/public/*` methods **require a customer `auth`** (no service
  default — they accept only `CustomerAccessToken`). (User-selected.)
- **D4 — React hooks:** `useMyRewardPoints`, `useMyRewardPointsSummary`
  (queries, customer-only ctx), `useRedeemRewardPoints` (mutation → coupon),
  `useRedeemOptions` (query, browser ctx). (User-selected.)
- **D5 — Types via codegen + aliasing:** add `reward-points` to
  `fetch-specs.ts`; `reward-points-types.ts` aliases the generated types
  (`CustomerSummaryBatchOut`, `PointsSummaryOut`, `CustomerSummary`,
  `AddedPoints`, `RedeemedPoints`, `NewCustomerIn`, `RedeemOption`,
  `RedeemOptions`, `RedeemCouponOut`). Structural definitions only for the
  inlined public-redeem body. Final names pinned at codegen.
- **D6 — Mixed base paths (quirk):** customer/public/batch endpoints are
  `/reward-points/…` (**no `{tenant}`**); redeem-options are
  `/reward-points/{tenant}/redeemOptions`. Handled by two path helpers.

## Public types (final names pinned in codegen)

`CustomerSummaryBatch` (batch), `PointsSummary` (customer/own summary),
`CustomerPointsSummary` (the `customer/{id}` detail — `addedPoints`/`redeemedPoints`
arrays), `AddedPoints`, `RedeemedPoints`, `NewPointsEntry` (create body),
`RedeemOption` (`{ id?, type?, name?, description?, points?, coupon?, … }`),
`RedeemOptionList`, `RedeemMyPointsInput` (**inlined** → structural
`{ redeemOptionId: string }`), `RedeemCouponResult` (`{ code? }`).

## Service surface (`client.rewardPoints`)

| Group | Method | HTTP | Path | Auth | Returns |
|---|---|---|---|---|---|
| Admin | `listAllSummaries(query?, auth?)` | GET | `/reward-points/summaryBatch` | service | `CustomerSummaryBatch` |
| Admin | `getCustomerPoints(customerId, auth?)` | GET | `/reward-points/customer/{id}` | service | `CustomerPointsSummary` |
| Admin | `createCustomerPoints(customerId, input, auth?)` | POST | `/reward-points/customer/{id}` | service | `void` |
| Admin | `deleteCustomerPoints(customerId, auth?)` | DELETE | `/reward-points/customer/{id}` | service | `void` |
| Admin | `getCustomerSummary(customerId, auth?)` | GET | `/reward-points/customer/{id}/summary` | service | `PointsSummary` |
| Admin | `addPoints(customerId, input, auth?)` | POST | `/reward-points/customer/{id}/addPoints` | service | `void` |
| Admin | `redeemPoints(customerId, input, auth?)` | POST | `/reward-points/customer/{id}/redeemPoints` | service | `void` |
| Store | `getMyPoints(auth)` | GET | `/reward-points/public/customer` | customer (req) | `CustomerPointsSummary` |
| Store | `getMySummary(auth)` | GET | `/reward-points/public/customer/summary` | customer (req) | `PointsSummary` |
| Store | `redeemMyPoints(input, auth)` | POST | `/reward-points/public/customer/redeem` | customer (req) | `RedeemCouponResult` |
| Opts | `listRedeemOptions(auth?)` | GET | `/reward-points/{tenant}/redeemOptions` | service (override→customer) | `RedeemOptionList` |
| Opts | `createRedeemOption(input, auth?)` | POST | `/reward-points/{tenant}/redeemOptions` | service | `RedeemOption` |
| Opts | `updateRedeemOption(id, input, auth?)` | PUT | `/reward-points/{tenant}/redeemOptions/{id}` | service | `RedeemOption` |
| Opts | `deleteRedeemOption(id, auth?)` | DELETE | `/reward-points/{tenant}/redeemOptions/{id}` | service | `void` |

`customerId` / `redeemOptionId` are `encodeURIComponent`-escaped. Exact create/
add/redeem/update response shapes (full body vs void/201) pinned at codegen.

## React hooks (`@viu/emporix-sdk-react`)

- `useMyRewardPoints()` → query, `useCustomerOnlyCtx`, `getMyPoints`.
- `useMyRewardPointsSummary()` → query, `useCustomerOnlyCtx`, `getMySummary`.
- `useRedeemRewardPoints()` → mutation `({ redeemOptionId }) => redeemMyPoints(...)`, customer ctx; invalidates `["emporix","reward-points"]`.
- `useRedeemOptions()` → query, `useReadAuth` (works for guest + customer), `listRedeemOptions`.

## Error handling

Shared `errorFromResponse` via `HttpClient`. No service-specific errors.

## Testing

- **Core (Vitest + MSW):** `reward-points-types.test.ts`, `reward-points.test.ts`
  (each method: token/path/body, the no-tenant vs tenant paths, customer-token
  on `/public/*`, redeem→coupon, `encodeURIComponent`, 404), `reward-points-wiring.test.ts`.
- **React (jsdom):** `use-reward-points.test.tsx` — the four hooks call the
  client with the customer/browser context and surface data.

## Out of scope

Nothing within the service is deferred. No admin read hooks.

## Deliverables

Codegen + `reward-points-types.ts` + `RewardPointsService` + wiring (logger
`"reward-points"`, facade `src/reward-points.ts`, barrel) + 4 React hooks +
`docs/reward-points.md` + `docs/react.md` mention + changeset (minor **both**
packages). Branch `feat/reward-points-service` off `main`, created at execution.
