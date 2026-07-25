# Site-Settings Admin CRUD — Design

**Date:** 2026-07-25
**Package:** `@viu/emporix-sdk`
**Service:** `SiteService` (`client.sites`)
**Spec source:** `packages/sdk/specs/site-settings-service.yml` → generated `src/generated/site-settings-service/types.gen.ts`

## Goal

`SiteService` today is read-only: `list`, `get`, and the derived `current`. The
site configuration writes and the entire site-mixin group are missing. This work
adds those 11 operations, completing coverage of the service's 13 operations.

## Scope

Extend the existing `SiteService` class with flat methods for the site writes
plus a `mixins` sub-resource. No new class, no client wiring change, no
constructor change.

**Verified against the generated types:** 13 operations, **none deprecated**,
2 wrapped → **11 to implement**. (`current` is derived from `list`, not its own
endpoint.)

### Already covered (unchanged)

`list` (GET `/sites`), `get` (GET `/sites/{siteCode}`), and `current` (picks the
`default: true` site out of `list`).

## Auth model

Writes default to `SERVICE` via a new `const SERVICE: AuthContext = auth.service()`
next to the existing `ANON` (the `auth` helper is already imported), always
overridable through the trailing `authCtx` argument. The new reads default to
`ANON`, matching the existing ones.

Note the parameter in this file is named **`authCtx`**, not `auth` — `auth` is
the imported helper module, so shadowing it would break `auth.service()`. (Same
constraint as the payment service in #171.)

## API surface

### 1 — Site writes + the codes read

| Method | HTTP | Auth | Returns |
|---|---|---|---|
| `create(input, authCtx?)` | POST `/sites` | SERVICE | `SiteCreated` (201) |
| `update(siteCode, input, authCtx?)` | PATCH `/sites/{siteCode}` | SERVICE | `void` |
| `replace(siteCode, input, options?, authCtx?)` | PUT `/sites/{siteCode}` | SERVICE | `void` |
| `delete(siteCode, authCtx?)` | DELETE `/sites/{siteCode}` | SERVICE | `void` (204) |
| `listCodes(authCtx?)` | GET `/siteslist` | ANON | `string[]` (200) |

- Naming follows the established split: `update` = PATCH (partial), `replace` =
  PUT (full) — both verbs exist here, as in #166 / #168 / #170.
- **Return type `void` for `update`/`replace`:** both respond 200 but the spec
  defines no body schema (generated as `unknown`). Rather than hand back an
  unusable value or force a hidden second request, the methods return nothing;
  callers re-read with `get(siteCode)` when they need the updated site.
- `replace` is the only one with a query parameter: `options = { expand?: string }`,
  sent only when provided.
- `listCodes` returns the bare `string[]` of site codes. It overlaps with
  `list().map(s => s.code)` but is a distinct, cheaper endpoint.

### 2 — `sites.mixins` sub-resource

A `readonly mixins = { … }` object literal of arrow functions (capturing
`this.ctx`), matching the sub-resource pattern in `segment.ts`, `category.ts`,
`product.ts` and `payment.ts`.

| Method | HTTP | Auth | Returns |
|---|---|---|---|
| `list(siteCode, authCtx?)` | GET `/sites/{siteCode}/mixins` | ANON | `SiteMixins` (200) |
| `get(siteCode, mixinName, authCtx?)` | GET `/sites/{siteCode}/mixins/{mixinName}` | ANON | `SiteMixin` (200) |
| `create(siteCode, input, authCtx?)` | POST `/sites/{siteCode}/mixins` | SERVICE | `SiteMixinCreated` (201) |
| `update(siteCode, mixinName, input, authCtx?)` | PATCH `/sites/{siteCode}/mixins/{mixinName}` | SERVICE | `void` |
| `replace(siteCode, mixinName, input, authCtx?)` | PUT `/sites/{siteCode}/mixins/{mixinName}` | SERVICE | `void` |
| `delete(siteCode, mixinName, authCtx?)` | DELETE `/sites/{siteCode}/mixins/{mixinName}` | SERVICE | `void` (204) |

`update`/`replace` return `void` for the same reason as the site writes (200
with no defined body). None of the mixin endpoints declare query parameters.

### 3 — Public types (alias → generated)

Declared in `packages/sdk/src/services/site-types.ts` (where the existing `Site`
alias lives) and re-exported from `services/site.ts`.

| Public alias | Generated type |
|---|---|
| `SiteInput` | `SiteDto` |
| `SiteCreated` | `ResourceLocation` |
| `SiteMixin` | `Mixin` |
| `SiteMixins` | `Mixins` |
| `SiteMixinCreated` | `ResourceLocation` |

Two notes:

- **`Mixin` and `Mixins` are open maps** (`{ [key: string]: unknown }`) — the
  spec defines no structure for site mixins. The aliases keep that shape; no
  fields are invented.
- **Writes use `SiteInput` (raw `SiteDto`), reads keep `Site`.** The existing
  `Site` type re-tightens `active`/`default` to required because the storefront
  relies on them; for create/patch bodies those fields are legitimately
  optional, so the write input stays the generated `SiteDto`.

`packages/sdk/src/index.ts` exports `SiteService` and `Site` explicitly (not via
a `export *` barrel), so the new type names are added there.

## Error handling

No new error handling — the shared `HttpClient` maps status codes to the
`Emporix*Error` hierarchy.

## Testing

New unit test `packages/sdk/tests/services/site-admin.test.ts` using the
`vi.fn()`-mocked `http.request` harness (`ctxWith`), mirroring
`payment-admin.test.ts`.

- **Site-write block:** `create`/`update`/`replace`/`delete` hit the right
  method + path with the `SERVICE` default; `replace` sends `expand` only when
  given (and no `query` key otherwise); an explicit `authCtx` override is
  honored.
- **Codes block:** `listCodes` GETs `/siteslist` with the `ANON` default and
  returns the array.
- **Mixins block:** all six methods hit the right method + path; reads default
  to `ANON`, writes to `SERVICE`.

## Release

Changeset `.changeset/site-settings-admin-crud.md`, `@viu/emporix-sdk` **minor**
(additive: new methods + types, no change to the existing reads).

## Out of scope

- React hooks (site configuration is admin work; the React bindings stay
  storefront-focused, consistent with prior admin PRs).
- Widening or re-typing the existing `Site` read alias.
- Live tenant verification (pure facade + unit tests, as with the prior admin
  PRs).
