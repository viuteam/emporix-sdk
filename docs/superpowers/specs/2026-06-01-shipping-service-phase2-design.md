# Shipping Service Binding (Phase 2 — Delivery Scheduling) — Design Spec

**Date:** 2026-06-01
**Status:** Approved (design)
**Package:** `@viu/emporix-sdk` (core only — no React binding)

## Summary

Extend the existing `client.shipping` service with **Phase 2**: delivery
scheduling — delivery windows, delivery times + slots, and delivery cycles
(19 operations). Phase 1 (config) is already shipped; this adds methods to the
same `ShippingService`.

## Background

Same Shipping Service (`/shipping/{tenant}/…`), OAuth2/service-token, no React.
The shipping OpenAPI was already fetched and generated in Phase 1, so the
scheduling types (`DeliveryTime`, `SlotCreation`, `ActualDeliveryWindows`,
`DeliveryCycle`, `Patch`, `DeliveryWindowValidationDto`, …) already exist under
`src/generated/shipping`. **No codegen, no client wiring** — just extend
`shipping-types.ts` and `ShippingService`.

All scheduling paths are tenant-scoped under `/shipping/{tenant}` (no `{site}`).

## Design decisions

- **D1 — Scope:** all 19 scheduling ops. (User-selected "B".)
- **D2 — Same service:** methods added to `ShippingService` / `client.shipping`.
- **D3 — No React; service-token default.**
- **D4 — Aliasing:** alias the already-generated scheduling types. PATCH uses a
  **JSON-Patch op-array** (`Patch`) — distinct from Phase 1's full-body patch.
  Slots use one schema (`SlotCreation`) for read + write. Creates return an
  inline `{ id? }` (typed `DeliveryCreated`); `generateDeliveryCycle` returns a
  bare `string`; updates/patches/deletes → `void`. Exact shapes pinned at codegen-verify.

## Public types (additions; final shapes pinned at codegen-verify)

`DeliveryWindow` (`ActualDeliveryWindow`) / `DeliveryWindowList`
(`ActualDeliveryWindows`); `DeliveryWindowValidation` (`DeliveryWindowValidationDto`);
`DeliveryTime` / `DeliveryTimeList` / `DeliveryTimeInput` (`BasicDeliveryTime`) /
`DeliveryTimeUpdate` (`UpdateDeliveryTime`); `DeliverySlot` (`SlotCreation`) /
`DeliverySlotList`; `DeliveryCycleInput` (`DeliveryCycle`); `ShippingPatch`
(`Patch`, JSON-Patch op-array); `DeliveryCreated` (`{ id? }`, structural — inline 201).

## Service surface (added to `client.shipping`)

| Group | Methods | Returns |
|---|---|---|
| Windows | `getAreaDeliveryWindows(deliveryAreaId, cartId, auth?)` (GET `/areaDeliveryTimes/{id}/{cartId}`) | `DeliveryWindowList` |
| | `getCartDeliveryWindows(cartId, auth?)` (GET `/actualDeliveryWindows/{cartId}`) | `DeliveryWindowList` |
| | `incrementDeliveryWindowCounter(input, auth?)` (POST `/actualDeliveryWindows/incrementCounter`) | `void` |
| | `validateDeliveryWindow(input, auth?)` (POST `/deliveryWindowValidation`) | `void` |
| Delivery Times | `listDeliveryTimes(query?, auth?)` / `getDeliveryTime(id, auth?)` | `DeliveryTimeList` / `DeliveryTime` |
| | `createDeliveryTime(input, auth?)` | `DeliveryCreated` |
| | `createDeliveryTimesBulk(inputs, auth?)` (POST `/delivery-times/bulk`) | `DeliveryCreated[]` |
| | `updateDeliveryTime(id, input, auth?)` / `patchDeliveryTime(id, ops, auth?)` / `deleteDeliveryTime(id, auth?)` | `void` |
| Slots | `listSlots(deliveryTimeId, auth?)` / `getSlot(deliveryTimeId, slotId, auth?)` | `DeliverySlotList` / `DeliverySlot` |
| | `createSlot(deliveryTimeId, input, auth?)` | `DeliveryCreated` |
| | `updateSlot(deliveryTimeId, slotId, input, auth?)` / `patchSlot(deliveryTimeId, slotId, ops, auth?)` / `deleteSlot(deliveryTimeId, slotId, auth?)` / `deleteAllSlots(deliveryTimeId, auth?)` | `void` |
| Cycles | `generateDeliveryCycle(input, auth?)` (POST `/delivery-cycles/generate`) | `string` |

Path segments `encodeURIComponent`-escaped. Create/bulk/validate/increment
response shapes pinned at codegen-verify.

## Testing

- **Core (Vitest + MSW):** extend `shipping-types.test.ts` (scheduling aliases)
  and `shipping.test.ts` (scheduling methods: paths under `/shipping/acme/…`,
  JSON-Patch body for patch, bulk array body, cycle returns a string,
  `encodeURIComponent`, 404).

## Out of scope

Phase 1 (config) is already shipped. Nothing further deferred — this completes
the Shipping Service binding.

## Deliverables

Extend `shipping-types.ts` + `ShippingService` + `docs/shipping.md` (fill the
Phase 2 section) + changeset (minor, `@viu/emporix-sdk` only). Branch
`feat/shipping-service-phase2` off `main`. No codegen, no wiring (already done in
Phase 1).
