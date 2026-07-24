# Invoice & Quote facades (Design)

**Date:** 2026-07-24
**Status:** approved (design)
**Package:** `@viu/emporix-sdk`
**Depends on:** `chore/register-missing-api-specs` (PR #155) — the generated
`invoice` / `quote` types only exist on that branch.

## Goal

Add hand-written service facades for the newly-registered specs that still lack
one. Of the 5 specs registered in #155, `site-settings-service` and
`session-context` already have facades (backed by generated types in #156), so
this covers the remaining three.

## Scope decisions

- **oauth-service → NO facade.** Its only operation is `POST /oauth/token` —
  the client-credentials token grant that the core `DefaultTokenProvider`
  already owns. A second public path to fetch tokens would duplicate and
  confuse the auth core. The generated types stay (internal, from #155); no
  service class.
- **invoice → `InvoiceService` (`client.invoices`).** Two ops (async job).
  Backend/admin — default auth `service`.
- **quote → `QuoteService` (`client.quotes`).** Quotes CRUD + PDF + history,
  with quote-reasons as a sub-resource `client.quotes.reasons`.

## Auth model (important nuance)

The user's intent for quotes is "customer-first with override". But the SDK
**core** `AuthContext` has no ambient customer token — `customer` is
`{ kind: "customer"; token }` (token required); auto-detection of a stored
customer token lives only in the React layer, not the core. Every SDK service
method therefore takes an explicit trailing `auth` argument with a default.

Realization, consistent with the existing customer-owned `CustomerService`
(which defaults `auth` to `{ kind: "anonymous" }`):

- **Quote** methods: trailing `auth: AuthContext = { kind: "anonymous" }`.
  Docs/examples are customer-first (`auth.customer(token)`); `delete` and the
  reason mutations require the admin `quote.quote_manage` scope (pass
  `auth.service()` or an admin token).
- **Invoice** methods: trailing `auth: AuthContext = { kind: "service" }`
  (backend-only, like `SchemaService` / `AiService`).
- **Quote reasons**: reads default `{ kind: "anonymous" }` (a storefront may
  list reason options); mutations default `{ kind: "service" }`.

## Facades

### `InvoiceService` — `services/invoice.ts` (channel `"invoice"`)

Types (`invoice-types.ts`, from `generated/invoice`):

| Alias | Generated |
|---|---|
| `InvoiceJobDraft` | `JobRequest` (`{ orderIds?, jobType: "AUTOMATIC" \| "MANUAL" }`) |
| `InvoiceJobCreated` | `JobCreationResponse` (`{ jobId? }`) |
| `InvoiceJob` | `JobStatusResponse` (`{ jobStatus?, jobType?, orders?[] }`) |

Methods (default `auth = { kind: "service" }`):
- `createJob(draft: InvoiceJobDraft, auth?): Promise<InvoiceJobCreated>` — `POST /invoice/{tenant}/jobs/invoices` (201)
- `getJob(jobId: string, auth?): Promise<InvoiceJob>` — `GET /invoice/{tenant}/jobs/invoices/{jobId}`

### `QuoteService` — `services/quote.ts` (channel `"quote"`)

Types (`quote-types.ts`, from `generated/quote`):

| Alias | Generated |
|---|---|
| `Quote` | `QuoteResponse` |
| `QuoteDraft` | `QuoteCreateRequest \| QuoteCreateFromCartRequest` |
| `QuoteCreated` | `QuoteIdResponse` (`{ id? }`) |
| `QuoteUpdate` | `QuoteUpdateRequest` (array of update ops) |
| `QuoteHistory` | `QuoteHistory` (array of history entries) |
| `QuoteReason` | `QuoteReasonResponse` |
| `QuoteReasonDraft` | `QuoteReasonCreateRequest` |
| `QuoteReasonUpdate` | `QuoteReasonUpdateRequest` |
| `QuoteReasonCreated` | `QuoteReasonIdResponse` |
| `ListQuotesQuery` | hand-written `{ q?; sort?; pageNumber?; pageSize? }` |
| `ListQuoteReasonsQuery` | hand-written `{ pageNumber?; pageSize? }` |

Quote methods (default `auth = { kind: "anonymous" }`, customer-first docs):
- `list(query?: ListQuotesQuery, auth?): Promise<PaginatedItems<Quote>>` — `GET /quotes` (wrap the array like `listSchemas`; `hasNextPage = items.length === pageSize`)
- `create(draft: QuoteDraft, auth?): Promise<QuoteCreated>` — `POST /quotes` (201)
- `get(quoteId, auth?): Promise<Quote>` — `GET /quotes/{quoteId}`
- `update(quoteId, update: QuoteUpdate, auth?): Promise<Quote>` — `PATCH /quotes/{quoteId}`
- `delete(quoteId, auth?): Promise<void>` — `DELETE /quotes/{quoteId}` (needs `quote_manage`)
- `history(quoteId, auth?): Promise<QuoteHistory>` — `GET /quotes/{quoteId}/history`
- `generatePdf(quoteId, auth?): Promise<Blob>` — `POST /quotes/{quoteId}/pdf` — **binary**; use `ctx.http.requestRaw` and return `await res.blob()`; throw `errorFromResponse` when `!res.ok` (`requestRaw` does NOT map non-2xx to typed errors).
- `reasons` getter → `QuoteReasonsResource` (lazily instantiated)

`QuoteReasonsResource` (exposed as `client.quotes.reasons`):
- `list(query?: ListQuoteReasonsQuery, auth = { kind: "anonymous" }): Promise<PaginatedItems<QuoteReason>>` — `GET /quote-reasons`
- `get(reasonId, auth = { kind: "anonymous" }): Promise<QuoteReason>` — `GET /quote-reasons/{id}`
- `create(draft: QuoteReasonDraft, auth = { kind: "service" }): Promise<QuoteReasonCreated>` — `POST /quote-reasons`
- `update(reasonId, draft: QuoteReasonUpdate, auth = { kind: "service" }): Promise<QuoteReason>` — `PUT /quote-reasons/{id}`
- `delete(reasonId, auth = { kind: "service" }): Promise<void>` — `DELETE /quote-reasons/{id}` (needs `quote_manage`)

## Wiring (per new service)

1. `core/logger.ts` — add `"invoice"` and `"quote"` to the `ServiceName` union
   (closed type; `static readonly channel` must be assignable).
2. `client.ts` — import the class, declare `readonly invoices: InvoiceService`
   / `readonly quotes: QuoteService`, instantiate `new XService(mk(X.channel))`
   in the constructor.
3. `index.ts` — `export { InvoiceService } from "./services/invoice"` + the
   public `export type { … }`; same for quote (mirrors the `SiteService` /
   `SessionContextService` exports).
4. **No** subpath export (no `tsup.config` / `package.json#exports` change) —
   consistent with `schema` / `ai` / `site`, which are reachable via the client
   and the main index only.

## Testing

TDD, Vitest + MSW, mirroring `tests/services/schema*.test.ts`. Per service:
- runtime tests for each method (path, method, auth default, body/query
  forwarding, response mapping);
- `generatePdf`: assert a `Blob` is returned and a non-2xx throws;
- a type-level `expectTypeOf` test locking the aliases (`*-types.test.ts`).

## Release & docs

- New `docs/invoice.md`, `docs/quote.md`; note in
  `docs/emporix-upstream-changelog.md` that oauth-service is intentionally
  unwrapped.
- Changeset: `@viu/emporix-sdk` **minor** (new `client.invoices` /
  `client.quotes` surface).

## Out of scope

- oauth-service facade (see Scope decisions).
- React bindings for quotes/invoices (server-side / customer-token flows; a
  future `useEmporixQuery`-based binding could add customer auto-detection for
  quotes).
- Deep typing of the `QuoteUpdate` op union beyond the generated
  `QuoteUpdateRequest` (passed through verbatim).
