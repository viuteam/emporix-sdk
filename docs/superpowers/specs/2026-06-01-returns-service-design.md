# Returns Service Binding — Design Spec

**Date:** 2026-06-01
**Status:** Approved (design)
**Packages:** `@viu/emporix-sdk` (core) + `@viu/emporix-sdk-react` (customer self-service hooks)

## Summary

Bind the Emporix **Returns Service** (`/return/{tenant}/returns`) as a single
service, `client.returns` (6 CRUD ops), plus three React hooks for customer
self-service (view + create own returns).

## Background

OAuth2 service-token API; scopes include `returns_*_own` (a customer can
read/manage their own returns) but the spec defines **no `CustomerAccessToken`
scheme** — so the SDK defaults to the service token and lets callers override
with `auth.customer(token)` (the coupon/reward-points pattern). Standard tenant
path. Read shapes differ by actor (customer vs employee return variants).

## Design decisions

- **D1 — Scope:** full CRUD (list/get/create/update/patch/delete).
- **D2 — One service:** `ReturnsService` → `client.returns`.
- **D3 — Auth default = service, overridable:** every method defaults `auth` to
  `{ kind: "service" }`; customer self-service passes `auth.customer(token)`
  (the React hooks do this).
- **D4 — React hooks:** `useMyReturns`, `useReturn`, `useCreateReturn` —
  customer-only (`useCustomerOnlyCtx`). (User-selected.)
- **D5 — Types via codegen + aliasing.** `Return` (read; union of customer/
  employee full-return variants), `ReturnList` (paged array), `ReturnInput`
  (`returnCreateBody`), `ReturnUpdate` (`returnUpdateBody`), `ReturnCreated`
  (`returnId` = `{ id }`). create → `{ id }`; update/patch/delete → `void`.
  Final names + read union pinned at codegen.

## Service surface (`client.returns`)

| Method | HTTP | Path | Returns |
|---|---|---|---|
| `listReturns(query?, auth?)` | GET | `/return/{tenant}/returns` | `ReturnList` |
| `getReturn(returnId, auth?)` | GET | `/return/{tenant}/returns/{id}` | `Return` |
| `createReturn(input, auth?)` | POST | `/return/{tenant}/returns` | `ReturnCreated` |
| `updateReturn(returnId, input, auth?)` | PUT | `/return/{tenant}/returns/{id}` | `void` |
| `patchReturn(returnId, patch, auth?)` | PATCH | `/return/{tenant}/returns/{id}` | `void` |
| `deleteReturn(returnId, auth?)` | DELETE | `/return/{tenant}/returns/{id}` | `void` |

`listReturns` supports `pageSize`/`pageNumber`/`sort`/`q` query params.
`returnId` is `encodeURIComponent`-escaped.

## React hooks (`@viu/emporix-sdk-react`)

Customer-only (throw without a stored token), customer auth context:

- `useMyReturns(opts?)` → query, `listReturns(query, ctx)`.
- `useReturn(returnId)` → query, `getReturn(id, ctx)`.
- `useCreateReturn()` → mutation, `createReturn(input, ctx)`; invalidates
  `["emporix", "returns"]`.

No admin read hooks; update/patch/delete stay server-side via the core.

## Error handling

Shared `errorFromResponse` via `HttpClient`. No service-specific errors.

## Testing

- **Core (Vitest + MSW):** `returns-types.test.ts`, `returns.test.ts` (each
  method: `Bearer svc-tok`, path, bodies, the `{ id }` create, 204 update/delete,
  `encodeURIComponent`, 404), `returns-wiring.test.ts`.
- **React (jsdom):** `use-returns.test.tsx` — the three hooks call the client
  with the customer token.

## Out of scope

Nothing within the Returns Service is deferred. No admin read hooks.

## Deliverables

Codegen + `returns-types.ts` + `ReturnsService` + wiring (logger `"returns"`,
facade `src/returns.ts`, barrel) + 3 React hooks + `docs/returns.md` +
`docs/react.md` mention + changeset (minor, **both** packages). Branch
`feat/returns-service` off `main`.
