# Admin: Customer Service (Batch 4) — Design Spec

**Date:** 2026-06-02
**Status:** Approved (design)
**Package:** `@viu/emporix-sdk` (core only — no React binding)

## Summary

Batch 4 of the admin set: bind the **Customer Service (tenant-managed)** as
`client.customerAdmin` — admin/seller CRUD over customer profiles and their
addresses (`/customer/{tenant}/customers`, 15 ops).

**`client-management` is intentionally NOT bound** — its endpoints
(`/customer-management/{tenant}/legal-entities | contact-assignments | locations`)
are already covered by `client.companies` / `client.contacts` / `client.locations`.

## Background

OAuth2/service-token (no `CustomerAccessToken`) → core-SDK only, no React. This
is the seller/admin view of customers (`*BySellerDto` bodies, `CustomerForSellerDto`
read) — distinct from the storefront `client.customers` (signup/login/me). The
name `client.customers`, and the public types `Customer`/`Address`, are already
taken, so this service is `client.customerAdmin` with `AdminCustomer*`-prefixed
public types.

## Design decisions

- **D1 — Scope:** full surface (15 ops).
- **D2 — New service `client.customerAdmin`** (`CustomerAdminService`); skip `client-management`.
- **D3 — No React; service-token default, overridable.**
- **D4 — Types via codegen + aliasing**, prefixed `AdminCustomer*` to avoid
  barrel collisions. Create/upsert → `ResourceLocation`; patch → void (200 no
  body); delete → void. **Address tags pass via a `tags` query param** (not body).
  Seller-variant bodies (`*BySellerDto`) used for the admin service.

## Public types (final names pinned at codegen)

`AdminCustomer` (`CustomerForSellerDto`), `AdminCustomerList`,
`AdminCustomerInput` (`CustomerSignupBySellerDto`), `AdminCustomerUpdate`
(`CustomerUpdateBySellerDto`), `AdminCustomerPatch` (`CustomerPatchBySellerDto`),
`AdminCustomerCreated` (`ResourceLocation`), `AdminCustomerSearchQuery`;
`AdminCustomerAddress` (`Address`), `AdminCustomerAddressList`,
`AdminCustomerAddressInput` (`Address_2`), `AdminCustomerAddressUpdate`
(`AddressUpdateDto`).

## Service surface (`client.customerAdmin`, `/customer/{tenant}/customers`)

| Method | HTTP |
|---|---|
| `listCustomers(query?, auth?)` | GET `/customers` |
| `searchCustomers(query, auth?)` | POST `/customers/search` |
| `getCustomer(customerNumber, auth?)` | GET `/customers/{num}` |
| `createCustomer(input, auth?)` | POST `/customers` → `AdminCustomerCreated` |
| `upsertCustomer(customerNumber, input, auth?)` | PUT `/customers/{num}` → `AdminCustomerCreated` |
| `patchCustomer(customerNumber, patch, auth?)` | PATCH `/customers/{num}` → `void` |
| `deleteCustomer(customerNumber, auth?)` | DELETE `/customers/{num}` |
| `listAddresses(customerNumber, auth?)` | GET `/customers/{num}/addresses` |
| `getAddress(customerNumber, addressId, auth?)` | GET `…/addresses/{id}` |
| `addAddress(customerNumber, input, auth?)` | POST `…/addresses` → `AdminCustomerCreated` |
| `upsertAddress(customerNumber, addressId, input, auth?)` | PUT `…/addresses/{id}` → `AdminCustomerCreated` |
| `patchAddress(customerNumber, addressId, patch, auth?)` | PATCH `…/addresses/{id}` → `void` |
| `deleteAddress(customerNumber, addressId, auth?)` | DELETE `…/addresses/{id}` |
| `addAddressTags(customerNumber, addressId, tags, auth?)` | POST `…/addresses/{id}/tags?tags=…` |
| `removeAddressTags(customerNumber, addressId, tags, auth?)` | DELETE `…/addresses/{id}/tags?tags=…` |

Path segments `encodeURIComponent`-escaped; `tags` is a comma-joined query param.
Patch/tag response codes and the search body pinned at codegen.

## Testing

`customer-admin-types.test.ts`, `customer-admin.test.ts` (MSW — token, paths,
bodies, search POST, tags query, `encodeURIComponent`, 404), `customer-admin-wiring.test.ts`.

## Out of scope

`client-management` (covered by companies/contacts/locations). Remaining admin
batch: 5) approval (React hooks).

## Deliverables

Codegen + `customer-admin-types.ts` + `CustomerAdminService` + wiring (logger
`"customer-admin"`, facade `src/customer-admin.ts`, barrel) + `docs/customer-admin.md`
+ CLAUDE.md + changeset (minor, `@viu/emporix-sdk` only). Branch
`feat/admin-customer-service` off `main`.
