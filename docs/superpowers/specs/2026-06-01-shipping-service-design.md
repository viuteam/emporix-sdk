# Shipping Service Binding (Phase 1 — Config) — Design Spec

**Date:** 2026-06-01
**Status:** Approved (design)
**Package:** `@viu/emporix-sdk` (core only — no React binding)

## Summary

Bind the Emporix **Shipping Service** (`/shipping/{tenant}/…`) as a single
server-side service, `client.shipping`. This is **Phase 1**: the shipping-config
cluster (sites, zones, methods, cost/quote, groups, customer-group relations) —
26 operations. **Phase 2** (delivery scheduling — windows, times, slots, cycles)
is deferred to a later branch on the same service.

## Background

One OAuth2/service-token service (no `CustomerAccessToken`) → core-SDK only, no
React. 45 ops total across 10 sub-domains; Phase 1 binds the ~26 config ops most
relevant to checkout shipping. Service-token default, overridable.

## Path structure

Base `/shipping/{tenant}`. Most config endpoints are **site-scoped**
(`/shipping/{tenant}/{site}/…`) — these methods take `site` as the first arg.
`findSites` is tenant-level (`/shipping/{tenant}/findSite`).

## Design decisions

- **D1 — Phase 1 scope:** sites/zones/methods/quote/groups/cgrelations (26 ops).
  Scheduling deferred (Phase 2). (User-selected.)
- **D2 — One service:** `ShippingService` → `client.shipping`; Phase 2 adds methods later.
- **D3 — No React:** service-token only.
- **D4 — Service-token default:** every method defaults `auth` to `{ kind: "service" }`.
- **D5 — Types via codegen + aliasing.** Read = write body for zone/method/group/
  cgrelation (same schema). Creates return a shared `ResourceCreatedResponse`;
  updates/patches/deletes resolve to `void` (pin at codegen). Zone/Method name
  fields have localized **string-or-map** variants upstream (union types).
- **D6 — `site` parameter:** site-scoped methods take `site` first; `findSites` does not.

## Public types (final names pinned in codegen)

`Site` / `SiteList` (`Sites`) / `FindSiteInput` (`FindSiteRequest`);
`Zone` / `ZoneList` (`Zones`); `ShippingMethod` (`Method`) / `ShippingMethodList`
(`Methods`); `ShippingGroup` (`Group`) / `ShippingGroupList` (`GroupList`);
`CgRelation` (`CGRelation`) / `CgRelationList` (`CGRelationList`);
`QuoteInput` (`QuotePayload`) / `QuoteResult` (`QuoteResponse`);
`QuoteSlotInput` (`QuoteSlot`) / `MinimumFee`; `ResourceCreated`
(`ResourceCreatedResponse`).

## Service surface (`client.shipping`)

| Group | Methods | Returns |
|---|---|---|
| Sites | `findSites(input, auth?)` (POST `/findSite`) | `SiteList` |
| Zones | `listZones(site, query?, auth?)` / `getZone(site, zoneId, auth?)` | `ZoneList` / `Zone` |
| | `createZone(site, zone, auth?)` | `ResourceCreated` |
| | `updateZone(site, zoneId, zone, auth?)` / `patchZone(site, zoneId, patch, auth?)` / `deleteZone(site, zoneId, auth?)` | `void` |
| Methods | `listMethods(site, zoneId, query?, auth?)` / `getMethod(site, zoneId, methodId, auth?)` | `ShippingMethodList` / `ShippingMethod` |
| | `createMethod(site, zoneId, method, auth?)` | `ResourceCreated` |
| | `updateMethod` / `patchMethod` / `deleteMethod` (`site, zoneId, methodId, …`) | `void` |
| Cost | `quote(site, input, auth?)` (POST `/quote`) | `QuoteResult` |
| | `quoteMinimum(site, input, auth?)` (POST `/quote/minimum`) | `MinimumFee` |
| | `quoteSlot(site, input, auth?)` (POST `/quote/slot`) | `MinimumFee` |
| Groups | `listGroups(site)` / `getGroup(site, groupId)` | `ShippingGroupList` / `ShippingGroup` |
| | `createGroup(site, group)` | `ResourceCreated` |
| | `updateGroup(site, groupId, group)` / `deleteGroup(site, groupId)` | `void` |
| CG-Relations | `listCgRelations(site)` / `getCgRelations(site, customerId)` | `CgRelationList` / `CgRelation` |
| | `createCgRelation(site, rel)` | `ResourceCreated` |
| | `updateCgRelations(site, customerId, rel)` / `deleteCgRelation(site, customerId)` | `void` |

All path segments are `encodeURIComponent`-escaped. Exact update/patch response
codes (void vs body) pinned at codegen.

## Error handling

Shared `errorFromResponse` via `HttpClient`. No service-specific errors.

## Testing

- **Core (Vitest + MSW):** `shipping-types.test.ts`, `shipping.test.ts` (each
  method: `Bearer svc-tok`, the site-scoped vs tenant paths, bodies,
  `encodeURIComponent`, 404), `shipping-wiring.test.ts`.

## Out of scope (Phase 2)

Delivery Windows (`/actualDeliveryWindows…`, `/deliveryWindowValidation`,
`/areaDeliveryTimes…`), Delivery Times + Slots (`/delivery-times…`), Delivery
Cycles (`/delivery-cycles/generate`).

## Deliverables

Codegen + `shipping-types.ts` + `ShippingService` + wiring (logger `"shipping"`,
facade `src/shipping.ts`, barrel) + `docs/shipping.md` + CLAUDE.md + changeset
(minor, `@viu/emporix-sdk` only). Branch `feat/shipping-service` off `main`.
