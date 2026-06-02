# Admin: Pick-Pack Service (Batch 3) — Design Spec

**Date:** 2026-06-02
**Status:** Approved (design)
**Package:** `@viu/emporix-sdk` (core only — no React binding)

## Summary

Batch 3 of the admin set: bind the **Pick-Pack Service** (`client.pickPack`,
`/pick-pack/{tenant}/…`) — order fulfillment / packlist management, assignees,
packaging, packing events, and recalculation jobs (12 ops).

## Background

OAuth2/service-token (no `CustomerAccessToken`) → core-SDK only, no React.
Standard tenant base path. These "orders" are fulfillment/packlist orders
(distinct from `client.orders` and the vendor service); methods live under
`client.pickPack`.

## Design decisions

- **D1 — Scope:** full surface (12 ops).
- **D2 — One service:** `client.pickPack`.
- **D3 — No React; service-token default, overridable.**
- **D4 — Types via codegen + aliasing.** Bodies: `OrderStatusChange` (PATCH order),
  `Assignee`, `PackagingProductsChange` (PUT), `OrderEntryEventCreate`,
  `RecalculationJobCreation`. Read: `Order`, `OrderEntryEventResponse`,
  `RecalculationJob`. Mutating responses (void vs body), the `/orders` packlist
  envelope, `/orderCycles` type, and the recalc trigger response pinned at codegen.

## Public types (final names pinned at codegen)

`PickOrder` (`Order`), `PickOrderList`; `OrderStatusChange`,
`PackagingProductsChange`, `OrderEntryEventCreate` (bodies, re-exported as-is);
`Assignee`; `PackingEvent` (`OrderEntryEventResponse`), `PackingEventList`;
`OrderCycleList`; `RecalculationJobInput` (`RecalculationJobCreation`),
`RecalculationJob`.

## Service surface (`client.pickPack`)

| Method | HTTP |
|---|---|
| `listOrders(query?, auth?)` | GET `/orders` (packlist) |
| `getOrder(orderId, auth?)` | GET `/orders/{orderId}` |
| `updateOrder(orderId, change, auth?)` | PATCH `/orders/{orderId}` (`OrderStatusChange`) |
| `finishOrder(orderId, auth?)` | POST `/orders/{orderId}/finish` |
| `listOrderCycles(query?, auth?)` | GET `/orderCycles` |
| `addAssignee(orderId, assignee, auth?)` | POST `/orders/{orderId}/assignees` |
| `removeAssignee(orderId, assigneeId, auth?)` | DELETE `/orders/{orderId}/assignees/{assigneeId}` |
| `updatePackaging(orderId, change, auth?)` | PUT `/orders/{orderId}/packaging` |
| `createEvent(event, auth?)` | POST `/events` (`OrderEntryEventCreate`) |
| `listEvents(query?, auth?)` | GET `/events` |
| `triggerRecalculation(input, auth?)` | POST `/jobs/recalculations` → `RecalculationJob` |
| `getRecalculationJob(jobId, auth?)` | GET `/jobs/recalculations/{jobId}` → `RecalculationJob` |

Path segments `encodeURIComponent`-escaped. Mutating-method response codes pinned at codegen.

## Testing

`pick-pack-types.test.ts`, `pick-pack.test.ts` (MSW — token, paths, bodies,
`encodeURIComponent`, 404), `pick-pack-wiring.test.ts`.

## Out of scope

Batches 4) customer-service + client-management · 5) approval (React).

## Deliverables

Codegen + `pick-pack-types.ts` + `PickPackService` + wiring (logger `"pick-pack"`,
facade `src/pick-pack.ts`, barrel) + `docs/pick-pack.md` + CLAUDE.md + changeset
(minor, `@viu/emporix-sdk` only). Branch `feat/admin-pick-pack` off `main`.
