# Payment Admin CRUD — Design

**Date:** 2026-07-25
**Package:** `@viu/emporix-sdk`
**Service:** `PaymentGatewayService` (`client.payments`)
**Spec source:** `packages/sdk/specs/payment.yml` → generated `src/generated/payment/types.gen.ts`

## Goal

`PaymentGatewayService` today wraps only the four storefront operations
(frontend payment-mode list/get, frontend initialize, frontend authorize). The
admin surface is missing: the payment-mode **configuration** CRUD and the
backend transaction lifecycle (authorize/capture/refund/cancel plus transaction
reads). This work closes that gap — 11 operations — completing coverage of the
15 operations in `payment.yml`.

**Count correction:** the running coverage table listed 13 missing operations for
payment. The actual number is **11** (15 total, 4 already wrapped). The overview
is corrected accordingly.

## Scope

Extend the existing `PaymentGatewayService` class with two sub-resources:
`modes` (payment-mode configuration) and `transactions` (lifecycle + reads).
No new class, no client wiring change, no constructor change.

### Already covered (unchanged)

`listPaymentModes` (GET `/paymentmodes/frontend`), `getMode` (GET
`/paymentmodes/frontend/{id}`), `initialize` (POST `/payment/frontend/initialize`),
`authorize` (POST `/payment/frontend/authorize`, customer-scoped via
`requireCustomer`).

## Naming

The new configuration operations cover the same domain nouns as the existing
frontend methods, so they are grouped into sub-resources rather than flattened —
this avoids `listPaymentModes` (frontend) colliding with a config-list method,
and matches the sub-resource pattern used in `segment.ts`, `category.ts` and
`product.ts`.

The backend `POST /payment/authorize` lives on the `transactions` sub-resource
as `transactions.authorize`: authorization is what *creates* the transaction
that `capture`/`refund`/`cancel` then act on, so the whole lifecycle sits in one
place, and there is no clash with the existing customer-scoped `authorize()`.

## Auth model

All new methods default to `SERVICE` auth via a new
`const SERVICE: AuthContext = auth.service()` next to the existing
`const ANON: AuthContext = auth.anonymous()`. Always overridable through the
trailing `authCtx` argument. The existing storefront methods keep their
`ANON` / `requireCustomer` behavior untouched.

## API surface

### 1 — `payments.modes` — payment-mode configuration

A `readonly modes = { … }` object literal of arrow functions (capturing
`this.ctx`).

| Method | HTTP | Returns |
|---|---|---|
| `list(authCtx?)` | GET `/paymentmodes/config` | `PaymentModeConfig[]` (200) |
| `get(id, authCtx?)` | GET `/paymentmodes/config/{id}` | `PaymentModeConfig` (200) |
| `create(input, authCtx?)` | POST `/paymentmodes/config` | `PaymentModeConfig` (200) |
| `update(id, input, authCtx?)` | PUT `/paymentmodes/config/{id}` | `PaymentModeConfig` (200) |
| `delete(id, authCtx?)` | DELETE `/paymentmodes/config/{id}` | `void` |

- The config list endpoint declares `query?: never` — it takes **no** query
  parameters, so `list` exposes none (no invented paging).
- `create` and `update` both respond **200** (not 201/204) with the full
  `PaymentModeResponse`.
- `delete` responds 200 with an unspecified body (`unknown` in the generated
  types); the method returns `void`.

### 2 — `payments.transactions` — lifecycle + reads

A `readonly transactions = { … }` object literal.

| Method | HTTP | Returns |
|---|---|---|
| `list(params?, authCtx?)` | GET `/transactions` | `PaymentTransaction[]` (200) |
| `get(transactionId, authCtx?)` | GET `/transactions/{transactionId}` | `PaymentTransaction` (200) |
| `authorize(input, authCtx?)` | POST `/payment/authorize` | `PaymentAuthorizeResult` (200) |
| `capture(transactionId, input?, authCtx?)` | POST `/payment/{transactionId}/capture` | `PaymentCaptureResult` (200) |
| `refund(transactionId, input?, authCtx?)` | POST `/payment/{transactionId}/refund` | `PaymentActionResult` (200) |
| `cancel(transactionId, authCtx?)` | POST `/payment/{transactionId}/cancel` | `PaymentActionResult` (200) |

- `list` `params`: `pageNumber?`, `pageSize?`, `sort?` (all numbers/strings — no
  boolean flags, so no `String(...)` conversion needed).
- `capture` body `{ amount?, currency? }` and `refund` body
  `{ amount?, currency?, captureId? }` are both declared optional (`body?`) in
  the spec, so the input parameter is optional; when omitted no body is sent.
- `cancel` takes **no** body.
- `capture`'s 200 response is an inline object carrying `successful?`,
  `message?` **and** `captureId?` — it is not `CommonPaymentResponse`, hence its
  own alias.
- `authorize` reuses the already-public `AuthorizePaymentInput`
  (`AuthorizePaymentRequest`) — the backend and frontend authorize endpoints take
  the same body; only path and auth differ.

### 3 — Public types (alias → generated)

| Public alias | Generated type |
|---|---|
| `PaymentModeConfig` | `PaymentModeResponse` |
| `PaymentModeCreateInput` | `PaymentModeRequest` |
| `PaymentModeUpdateInput` | `PaymentMethodUpdateRequest` |
| `PaymentTransaction` | `PaymentTransactionResponse` |
| `PaymentAuthorizeResult` | `AuthorizePaymentResponse` |
| `PaymentCaptureInput` | `CaptureRequest` |
| `PaymentRefundInput` | `RefundRequest` |
| `PaymentActionResult` | `CommonPaymentResponse` |
| `PaymentCaptureResult` | inline `{ successful?: boolean; message?: string; captureId?: string }` (declared in `payment.ts`) |

All exported from `packages/sdk/src/index.ts` alongside the existing payment
types.

## Error handling

No new error handling — the shared `HttpClient` maps status codes to the
`Emporix*Error` hierarchy. Note that the payment endpoints signal business
failure **in the 200 body** (`successful: false` + `message`), not via HTTP
status, so callers must check `successful` on capture/refund/cancel/authorize
results rather than relying on a thrown error.

## Testing

New unit test `packages/sdk/tests/services/payment-admin.test.ts` using the
`vi.fn()`-mocked `http.request` harness (`ctxWith`), mirroring
`product-admin.test.ts`.

- **`modes` block:** each method hits the right method + path with the `SERVICE`
  default; an explicit `authCtx` override is honored.
- **`transactions` block:** `list` forwards `pageNumber`/`pageSize`/`sort` and
  omits the query when no params are given; `get` hits
  `/transactions/{transactionId}`; `authorize` POSTs `/payment/authorize`;
  `capture`/`refund` POST their paths **with** a body when given and **without**
  a `body` property when omitted; `cancel` POSTs its path and sends no body.

## Release

Changeset `.changeset/payment-admin-crud.md`, `@viu/emporix-sdk` **minor**
(additive: new sub-resources + types, no change to the existing storefront
methods).

## Out of scope

- React hooks (admin config/lifecycle is server-side; the React bindings stay
  storefront-focused, consistent with prior admin PRs).
- Reworking the existing hand-written `AuthorizePaymentResult` interface into the
  generated `AuthorizePaymentResponse` — the storefront `authorize()` keeps its
  current public shape to avoid a breaking change.
- Live tenant verification (pure facade + unit tests, as with the prior admin
  PRs).
