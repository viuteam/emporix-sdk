# Webhook Service Binding — Design

- **Date:** 2026-06-01
- **Status:** Approved (design); pending implementation plan
- **Package:** `@viu/emporix-sdk` (core only)
- **Branch:** `feat/webhook-service`

## 1. Context & motivation

The SDK exposes a service binding per Emporix Commerce Engine service. The
**Webhook Service** (`/webhook/{tenant}/…`) is not yet bound. It is a small,
cohesive **admin** surface that lets a tenant:

- discover the catalog of available webhook **event subscriptions** and toggle
  them on/off (with per-event field exclusions);
- manage delivery **configurations** (which provider receives events: a shared
  Svix tenant, a dedicated Svix tenant, or a plain HTTP endpoint);
- read delivery **statistics** and obtain **dashboard access** to the Svix UI.

This design adds a single **core service** binding all of those endpoints,
consumed **server-side only** (clientCredentials token). No React bindings.

It follows the established "configuration service" pattern exactly: a codegen
entry feeds typed generated schemas; a focused service class wraps them with the
default `{ kind: "service" }` auth; a one-line facade re-exports it; the client
wires it via `mk("webhook")`; Vitest + MSW cover it; a `minor` changeset ships
it.

### Upstream API summary (verified against the live OpenAPI)

- **Spec URL** (HTTP 200):
  `https://raw.githubusercontent.com/emporix/api-references/refs/heads/main/webhooks/webhook-service/api-reference/api.yml`
  → `fetch-specs` key **`webhook`**.
- **Base path:** `/webhook/{tenant}`.
- **Auth:** OAuth2 `clientCredentials` only. Scopes:
  - `webhook.subscription_read` — read the subscription catalog.
  - `webhook.subscription_manage` — toggle subscriptions, manage configs,
    read statistics, obtain dashboard access.
  This is an **admin/service token**, never to be exposed in a browser.

#### Endpoints

| Method & path | Scope | Notes |
|---|---|---|
| `GET /event-subscriptions` | `subscription_read` | list the event-subscription catalog |
| `PATCH /event-subscriptions` | `subscription_manage` | **batch** subscribe/unsubscribe; body `WebhookSubscriptionUpdateItem[]`; returns **207** with a per-item result array |
| `GET /config` | `subscription_manage` | list delivery configs |
| `POST /config` | `subscription_manage` | create a config; returns `{ code }` |
| `GET /config/{code}` | `subscription_manage` | retrieve one config |
| `PUT /config/{code}` | `subscription_manage` | replace a config (**204**) |
| `PATCH /config/{code}` | `subscription_manage` | partial update a config (**204**) |
| `DELETE /config/{code}` | `subscription_manage` | delete a config; `?force=true` required to delete the active one |
| `GET /statistics` | `subscription_manage` | `?fromYearMonth&toYearMonth` (`YYYY-MM`); Svix-shared-oriented |
| `GET /dashboard-access` | `subscription_manage` | Svix dashboard access URL/token |

#### Shapes

- **`WebhookSubscription`** (read model):
  `{ event: { type, name (localized map), description (localized map), group (localized map), eventSchema }, subscription: "SUBSCRIBED" | "UNSUBSCRIBED" | "NONE", excludedFields: string[], metadata: { createdAt, modifiedAt, version } }`.
- **`WebhookSubscriptionUpdateItem`** (write model for the batch PATCH):
  `{ eventType (required), action?: "SUBSCRIBE" | "UNSUBSCRIBE", fieldsToUnsubscribe?: string[], fieldsToSubscribe?: string[], metadata?: { version } }`.
- **Per-item PATCH result** (one element of the 207 array):
  `{ eventType, code, status, message }`.
- **`WebhookConfig`**:
  `{ code, active, provider: "SVIX_SHARED" | "SVIX" | "HTTP", configuration }`,
  where `configuration` is a provider-discriminated `oneOf`:
  - `HTTP` → `{ destinationUrl, secretKey, headers (map, ≤10), eventsConfiguration[], secretKeyExists }`
  - `SVIX` → `{ apiKey }`
  - `SVIX_SHARED` → `{}`

#### Documented quirks (drive design decisions)

1. **Only one config may be `active: true`.** Deleting the active config
   requires `?force=true`; otherwise the server rejects it.
2. **`PATCH /event-subscriptions` returns 207 Multi-Status**, not 200. Each
   array element reports its own `{ eventType, code, status, message }` — the
   batch can **partially** succeed. The SDK returns the parsed array verbatim so
   the caller can inspect per-item status; it does **not** throw on partial
   failure (the HTTP call itself succeeded).
3. **Field filtering is root-level only** — `fieldsToSubscribe` /
   `fieldsToUnsubscribe` / `excludedFields` operate on top-level fields.
4. **`metadata.version`** provides optimistic locking on the subscription PATCH.
5. **Statistics is SVIX_SHARED-oriented** — meaningful mainly for the shared
   provider.
6. **`secretKey` is write-only.** `GET /config/{code}` never returns it; it
   returns `secretKeyExists: boolean` instead. Callers re-send `secretKey` only
   when rotating it.

## 2. Decisions (resolved during brainstorming)

| # | Decision | Choice |
|---|---|---|
| D1 | Scope | **Bind all 10 endpoints** — small cohesive admin surface; full coverage is cheaper to ship and document than a partial slice |
| D2 | React bindings | **None** — core SDK only, server-side consumption |
| D3 | API shape | **One service**: `client.webhooks` (the endpoints share one base path and one auth profile) |
| D4 | 207 batch PATCH | `updateEventSubscriptions` returns the **parsed per-item result array** (`WebhookSubscriptionUpdateResultItem[]`); never throws on partial failure; partial-failure handling documented |
| D5 | DELETE force flag | `deleteConfig(code, { force? })` → serialized as `?force=true` only when `force === true` (mirrors the `?keys=` opt-object precedent in `tenant-config`) |
| D6 | Types source | Codegen via existing `@hey-api/openapi-ts` pipeline + thin public aliases re-exported from generated names |
| D7 | Default auth | `{ kind: "service" }` (credential set `"backend"`), overridable per call — identical to `tenant-config` / `media` |
| D8 | Method naming | Verb-noun mirroring the HTTP verbs and resources (see §3) |

## 3. Public API surface

```ts
// types (src/services/webhook-types.ts) — thin aliases over generated schemas
export type WebhookSubscription = GenWebhookSubscription;
export type WebhookSubscriptionUpdateItem = GenWebhookSubscriptionUpdateItem;
export type WebhookSubscriptionUpdateResultItem = GenWebhookSubscriptionUpdateResult; // 207 element
export type WebhookConfig = GenWebhookConfig;
export type WebhookConfigDraft = GenWebhookConfigDraft;   // POST/PUT body (no server-managed fields)
export type WebhookConfigPatch = GenWebhookConfigPatch;   // PATCH body (partial)
export type WebhookConfigCreated = { code: string };       // POST /config response
export type WebhookStatistics = GenWebhookStatistics;
export type WebhookDashboardAccess = GenWebhookDashboardAccess;

/** `GET /statistics` range. Both are `YYYY-MM`. Omitted when absent. */
export interface WebhookStatisticsQuery {
  fromYearMonth?: string;
  toYearMonth?: string;
}

/** `DELETE /config/{code}` options. */
export interface DeleteConfigOptions {
  /** Required to delete the currently-active config. Serialized as `?force=true`. */
  force?: boolean;
}
```

> The generated type names may differ from the `Gen*` placeholders above; the
> thin alias layer absorbs that — the plan's Task 1 greps the generated file and
> the alias imports are adjusted to the actual emitted names.

```ts
// client.webhooks — WebhookService
listEventSubscriptions(auth?: AuthContext): Promise<WebhookSubscription[]>
updateEventSubscriptions(items: WebhookSubscriptionUpdateItem[], auth?: AuthContext): Promise<WebhookSubscriptionUpdateResultItem[]>  // 207

listConfigs(auth?: AuthContext): Promise<WebhookConfig[]>
getConfig(code: string, auth?: AuthContext): Promise<WebhookConfig>
createConfig(draft: WebhookConfigDraft, auth?: AuthContext): Promise<WebhookConfigCreated>  // { code }
replaceConfig(code: string, draft: WebhookConfigDraft, auth?: AuthContext): Promise<void>   // 204
patchConfig(code: string, patch: WebhookConfigPatch, auth?: AuthContext): Promise<void>     // 204
deleteConfig(code: string, opts?: DeleteConfigOptions, auth?: AuthContext): Promise<void>

getStatistics(query?: WebhookStatisticsQuery, auth?: AuthContext): Promise<WebhookStatistics>
getDashboardAccess(auth?: AuthContext): Promise<WebhookDashboardAccess>
```

### Behavioral notes

- **207 PATCH:** `request<T>` treats any 2xx (incl. 207) as success and returns
  the parsed body. `updateEventSubscriptions` therefore returns the per-item
  result array directly; callers iterate it to detect per-item failures (e.g.
  `results.filter(r => r.code >= 400)`). The SDK does **not** throw on a 207 with
  failed items — only on a non-2xx HTTP status.
- **`deleteConfig`:** `query: { force: true }` only when `opts.force === true`;
  omitted otherwise (so the common non-active delete sends no query string).
- **`getStatistics`:** `fromYearMonth` / `toYearMonth` included individually only
  when present; an empty `query` produces no query string.
- **204 endpoints** (`replaceConfig`, `patchConfig`, `deleteConfig`): typed as
  `Promise<void>`; the empty body parses to `undefined`.
- **`code` is `encodeURIComponent`-escaped** in all `/config/{code}` paths.
- No convenience sugar (no "subscribe one event" helper, no provider-specific
  config builders) — YAGNI; callers pass the wire shapes.

## 4. Auth & data flow

- Module-level default: `const SERVICE: AuthContext = { kind: "service" }`
  (resolves to the `"backend"` credential set via `DefaultTokenProvider.getToken`).
  Every method takes a trailing optional `auth` defaulting to `SERVICE`.
- All requests go through `this.ctx.http.request<T>({ method, path, query, body, auth })`.
- Paths:
  - `/webhook/${tenant}/event-subscriptions`
  - `/webhook/${tenant}/config` and `…/config/${enc(code)}`
  - `/webhook/${tenant}/statistics`
  - `/webhook/${tenant}/dashboard-access`
- Server-only contract is documented; no anonymous/customer default, no React
  surface, no e2e (the admin token must not live in the vite-spa).

## 5. Codegen integration

The `webhook` entry must be added to `packages/sdk/scripts/fetch-specs.ts`
`SPECS`:

```ts
webhook: `${BASE}/webhooks/webhook-service/api-reference/api.yml`,
```

(URL verified live → HTTP 200.) Then:

```bash
pnpm -F @viu/emporix-sdk fetch:specs && pnpm -F @viu/emporix-sdk generate
```

→ produces `src/generated/webhook/{index.ts,types.gen.ts}` (types only). Public
aliases in `src/services/webhook-types.ts` import the generated base types and
re-export them under the SDK's public names. If hey-api emits different names
(e.g. for the 207 result element or the config draft/patch bodies), the alias
imports are adjusted to match — the thin layer absorbs that.

## 6. Wiring

- `src/core/logger.ts`: add `"webhook"` to the `ServiceName` union (before
  `| "http"`).
- `src/client.ts`:
  - `import { WebhookService } from "./services/webhook";`
  - add `readonly webhooks: WebhookService;`
  - construct with `this.webhooks = new WebhookService(mk("webhook"));`
- `src/index.ts`: `export * from "./webhook";`
- `src/webhook.ts`: one-line `export * from "./services/webhook";`

## 7. Error handling

Reuse the existing HTTP error mapping in `core/http` + `core/errors`:
- 404 → `EmporixNotFoundError` (propagates from `getConfig`/`replaceConfig`/
  `patchConfig`/`deleteConfig`).
- 409 → existing conflict error (e.g. deleting the active config without
  `force`, or a stale `metadata.version` on the subscription PATCH).
- 400 → existing validation error.
- **207 is NOT an error** — it is a success status; per-item failures are
  surfaced in the returned array, not thrown. No service-specific catch logic.

## 8. Testing (Vitest + MSW)

`tests/services/webhook.test.ts` (same MSW harness as `tenant-config.test.ts`:
mock `POST https://api.emporix.io/oauth/token` → `{ access_token: "svc-tok", … }`;
assert the request `Authorization` header is `Bearer svc-tok`):

- `listEventSubscriptions` GETs `/event-subscriptions`, returns the catalog,
  carries the service token.
- `updateEventSubscriptions` PATCHes `/event-subscriptions`, posts the items
  array, and returns the parsed **207** per-item result array (assert the mock
  responds with `status: 207` and the SDK does **not** throw; assert a partially
  failed item is observable in the result).
- `listConfigs` GETs `/config`.
- `getConfig` GETs `/config/{code}`; `getConfig` → 404 throws
  `EmporixNotFoundError`.
- `createConfig` POSTs the draft and returns `{ code }`.
- `replaceConfig` PUTs and resolves to `void` on 204.
- `patchConfig` PATCHes and resolves to `void` on 204.
- `deleteConfig` DELETEs with **no** query by default; `deleteConfig(code,
  { force: true })` sends `?force=true`.
- `deleteConfig` of the active config without force → 409 throws (asserts the
  existing conflict error propagates).
- `getStatistics` serializes `fromYearMonth`/`toYearMonth`; empty query sends no
  query string.
- `getDashboardAccess` GETs `/dashboard-access`.
- `encodeURIComponent`-escapes the `code` in the path.
- `tests/services/webhook-wiring.test.ts`: `EmporixClient` exposes `webhooks`
  as a `WebhookService` instance.

## 9. Out of scope (YAGNI)

- React hooks / `@viu/emporix-sdk-react` surface.
- e2e (admin token must not live in the vite-spa).
- Provider-specific config builders / a "subscribe one event" convenience.
- Client-side optimistic-locking helpers around `metadata.version`.
- Retry/aggregation logic over 207 partial failures (returned verbatim).
- Polling/long-poll over statistics.

## 10. File-by-file change list

| File | Change |
|---|---|
| `packages/sdk/scripts/fetch-specs.ts` | add `webhook` spec entry |
| `packages/sdk/specs/webhook.yml` | fetched (committed artifact) |
| `packages/sdk/src/generated/webhook/**` | generated (committed) |
| `packages/sdk/src/services/webhook-types.ts` | new — public type aliases |
| `packages/sdk/src/services/webhook.ts` | new — `WebhookService` |
| `packages/sdk/src/webhook.ts` | new — facade re-export |
| `packages/sdk/src/core/logger.ts` | add `"webhook"` to `ServiceName` |
| `packages/sdk/src/client.ts` | wire `webhooks` |
| `packages/sdk/src/index.ts` | re-export the facade |
| `packages/sdk/tests/services/webhook.test.ts` | new MSW tests |
| `packages/sdk/tests/services/webhook-wiring.test.ts` | new wiring test |
| `docs/webhook.md` | new — usage doc |
| `CLAUDE.md` | add Webhooks to the service list |
| `.changeset/*.md` | `minor`: new `client.webhooks` service |
