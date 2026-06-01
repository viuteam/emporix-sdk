# Configuration Service Binding — Design

- **Date:** 2026-05-29
- **Status:** Approved (design); pending implementation plan
- **Package:** `@viu/emporix-sdk` (core only)
- **Branch:** `feat/configuration-service`

## 1. Context & motivation

The SDK exposes a service binding per Emporix Commerce Engine service. The
**Configuration Service** (`/configuration/{tenant}/…`) is not yet bound. It
stores tenant-wide and per-client key/value configuration (settings, feature
flags, integration config) with optional encryption, JSON-Schema validation,
and write-protection flags.

This design adds full CRUD bindings for both resource groups as **two separate
core services**, consumed **server-side only**. No React bindings.

### Upstream API summary (verified against the live OpenAPI + docs)

- **Auth:** OAuth2 `clientCredentials` only. Scopes:
  - `configuration.configuration_view` — read
  - `configuration.configuration_manage` — write
  This is an **admin/service token**, never to be exposed in a browser.
- **Tenant configurations** — `/configuration/{tenant}/configurations`
  - `GET /configurations?keys=` — list (optional CSV `keys` filter)
  - `POST /configurations` — create; body is an **array**; returns array (201)
  - `GET /configurations/{propertyKey}` — retrieve one
  - `PUT /configurations/{propertyKey}` — update one (body: single object)
  - `DELETE /configurations/{propertyKey}` — delete (204)
- **Client configurations** — `/configuration/{tenant}/clients/{client}/configurations`
  - Same operations; list/get/update/delete take a `{client}` path segment.
  - Body items additionally carry `_id` (server-assigned) and `client`.
  - **Verify during implementation:** GET (list + by key), POST, PUT for client
    configs are confirmed in the docs. The client `DELETE` endpoint is assumed
    symmetric with the tenant one — confirm against the generated spec; drop
    `clientConfig.delete` if the API does not expose it.
- **`BaseConfiguration` shape:**
  - `key: string` (required)
  - `value: object | string | array | boolean` (required; any valid JSON)
  - `version: integer` (server-managed)
  - `description?: string`
  - `secured?: boolean` (default false; encrypts `value` only when it is a string)
  - `restricted?: boolean` (default false; when true, cannot be deleted; cannot be unset)
  - `readOnly?: boolean` (default false; when true, cannot be updated)
  - `schemaUrl?: string` (JSON-Schema URL for validation; immutable once set)
  - `Configuration` (tenant) = `BaseConfiguration`
  - `ClientConfiguration` = `BaseConfiguration` + `{ _id: string; client: string }`

## 2. Decisions (resolved during brainstorming)

| # | Decision | Choice |
|---|---|---|
| D1 | Scope | **Full CRUD** on **both** tenant and client configurations |
| D2 | React bindings | **None** — core SDK only, server-side consumption |
| D3 | API shape | **Two separate services**: `client.tenantConfig` + `client.clientConfig` (analogous to `orders`/`salesOrders`) |
| D4 | Method name for DELETE | `delete` (precedent: `locations.ts`, `companies.ts`; mirrors the HTTP verb) |
| D5 | Value typing | Generic `<T = unknown>` overlaid on the generated base type |
| D6 | Types source | Codegen via existing `@hey-api/openapi-ts` pipeline + thin public aliases |
| D7 | Default auth | `{ kind: "service" }` (credential set `"backend"`), overridable per call — identical to `price.ts` / `media.ts` |

## 3. Public API surface

```ts
// types (src/services/configuration-types.ts)
export type Configuration<T = unknown> = Omit<GenConfiguration, "value"> & { value: T };
export type ClientConfiguration<T = unknown> = Configuration<T> & { _id: string; client: string };
// input for create/update — omits server-managed fields (version, _id)
export type ConfigurationDraft<T = unknown> = {
  key: string;
  value: T;
  description?: string;
  secured?: boolean;
  restricted?: boolean;
  readOnly?: boolean;
  schemaUrl?: string;
};

export interface ListConfigOptions { keys?: string[] } // joined to CSV `keys=a,b`
```

```ts
// client.tenantConfig — TenantConfigService
list(opts?: ListConfigOptions, auth?: AuthContext): Promise<Configuration[]>
get<T = unknown>(key: string, auth?: AuthContext): Promise<Configuration<T>>
create(drafts: ConfigurationDraft[], auth?: AuthContext): Promise<Configuration[]>
update<T = unknown>(key: string, draft: ConfigurationDraft<T>, auth?: AuthContext): Promise<Configuration<T>>
delete(key: string, auth?: AuthContext): Promise<void>

// client.clientConfig — ClientConfigService (client id is always the first arg)
list(client: string, opts?: ListConfigOptions, auth?: AuthContext): Promise<ClientConfiguration[]>
get<T = unknown>(client: string, key: string, auth?: AuthContext): Promise<ClientConfiguration<T>>
create(client: string, drafts: ConfigurationDraft[], auth?: AuthContext): Promise<ClientConfiguration[]>
update<T = unknown>(client: string, key: string, draft: ConfigurationDraft<T>, auth?: AuthContext): Promise<ClientConfiguration<T>>
delete(client: string, key: string, auth?: AuthContext): Promise<void>
```

### Behavioral notes
- `keys?: string[]` → serialized as `query: { keys: keys.join(",") }`; omitted entirely when absent/empty.
- `clientConfig` **auto-injects** `client` into each body item from the path arg, so callers never repeat it. `_id` is never required on input (server-assigned).
- `create` mirrors the API (array in, array out). No single-item convenience wrapper (YAGNI).
- `key` and `client` are `encodeURIComponent`-escaped in paths.

## 4. Auth & data flow

- Module-level default in each service: `const SERVICE: AuthContext = { kind: "service" }`
  (resolves to the `"backend"` credential set via `DefaultTokenProvider.getToken`).
  Every method takes a trailing optional `auth` defaulting to `SERVICE`.
- All requests go through `this.ctx.http.req<T>({ method, path, query, body, auth })`.
- Paths:
  - tenant: `/configuration/${tenant}/configurations` and `…/configurations/${enc(key)}`
  - client: `/configuration/${tenant}/clients/${enc(client)}/configurations` and `…/${enc(key)}`
- Server-only contract is documented; no anonymous/customer default, no React surface.

## 5. Codegen integration

1. `packages/sdk/scripts/fetch-specs.ts` — add to `SPECS`:
   ```ts
   configuration: `${BASE}/configuration/configuration-service/api-reference/api.yml`,
   ```
   (URL verified live → HTTP 200.)
2. `pnpm -F @viu/emporix-sdk fetch:specs && pnpm -F @viu/emporix-sdk generate`
   → produces `src/generated/configuration/{index.ts,types.gen.ts}` (types only).
3. Public aliases in `src/services/configuration-types.ts` import the generated
   base type and overlay the `<T>` generic on `value`. If the generated names
   differ from `Configuration`/`ClientConfiguration`, alias accordingly (the
   thin layer absorbs that — fallback C from the approaches).

## 6. Wiring

- `src/core/logger.ts`: add `"configuration"` to the `ServiceName` union.
- `src/client.ts`:
  - import `TenantConfigService`, `ClientConfigService`
  - add `readonly tenantConfig: TenantConfigService` and `readonly clientConfig: ClientConfigService`
  - construct both with `mk("configuration")`
- `src/index.ts`: re-export the public types and both service classes.
- `src/tenant-config.ts`, `src/client-config.ts`: one-line `export * from "./services/…"`.

## 7. Error handling

Reuse the existing HTTP error mapping in `core/http` + `core/errors`:
- 404 → `EmporixNotFoundError` (propagates from `get`/`update`/`delete`)
- 409 → existing conflict error (create/update)
- 400 → existing validation error
No service-specific catch logic (unlike `availability`'s default-on-404 helper).

## 8. Testing (Vitest + MSW)

`tests/tenant-config.test.ts` and `tests/client-config.test.ts`:
- `list` with and without `keys` filter (assert CSV query)
- `get` happy path; `get` → 404 throws `EmporixNotFoundError`
- `create` echoes the posted array
- `update` returns the single updated object
- `delete` → 204 resolves to `void`
- Authorization header carries the **service** token (assert bearer present)
- `secured: true` round-trips in the body
- `clientConfig` auto-injects `client` into each body item
- Type-level: `get<MyShape>(…)` yields `Configuration<MyShape>` (compile-time assertion)

## 9. Out of scope (YAGNI)

- React hooks / `@viu/emporix-sdk-react` surface
- e2e (admin token must not live in the vite-spa)
- Client-side JSON-Schema validation (server enforces `schemaUrl`)
- Caching, optimistic-locking helpers around `version`
- Single-item `create` convenience wrapper

## 10. File-by-file change list

| File | Change |
|---|---|
| `packages/sdk/scripts/fetch-specs.ts` | add `configuration` spec entry |
| `packages/sdk/src/generated/configuration/**` | generated (committed) |
| `packages/sdk/src/services/configuration-types.ts` | new — public types |
| `packages/sdk/src/services/tenant-config.ts` | new — `TenantConfigService` |
| `packages/sdk/src/services/client-config.ts` | new — `ClientConfigService` |
| `packages/sdk/src/tenant-config.ts` | new — re-export |
| `packages/sdk/src/client-config.ts` | new — re-export |
| `packages/sdk/src/core/logger.ts` | add `"configuration"` to `ServiceName` |
| `packages/sdk/src/client.ts` | wire both services |
| `packages/sdk/src/index.ts` | re-export types + classes |
| `packages/sdk/tests/tenant-config.test.ts` | new tests |
| `packages/sdk/tests/client-config.test.ts` | new tests |
| `docs/configuration.md` | new — usage doc |
| `CLAUDE.md` | add Configuration to the service list |
| `.changeset/*.md` | minor: new services `tenantConfig` / `clientConfig` |
