# SSO (Authorization Code / socialLogin) & RFC 8693 Token Exchange — Design

**Date:** 2026-05-19
**Status:** Approved (design)

## Goal

Add first-class SDK support for two additional Emporix customer-auth flows,
replacing the current "out of scope, use `raw`" note:

1. **Authorization Code (SSO)** — the storefront completes the IdP redirect
   itself; the SDK performs only the Emporix code exchange
   (`POST /customer/{tenant}/socialLogin`).
2. **RFC 8693 Token Exchange** — exchange an external IdP JWT for an Emporix
   customer session (`POST /customer/{tenant}/exchangeauthtoken`).

Both yield an Emporix customer session the caller then uses via
`auth.customer(token)` — exactly like `login`/`refresh`.

## Decisions (locked with the user)

| # | Decision |
|---|----------|
| 1 | Authorization Code: **socialLogin-exchange only**. The SDK does NOT build IdP redirect URLs or do PKCE; the caller supplies `code`/`codeVerifier`. |
| 2 | React: **extend `useCustomerSession`** with `socialLogin` + `exchangeToken` actions (store token like `login`). |
| 3 | Multi-site `config` (exchangeauthtoken): **optional per-call parameter**; omitted = tenant default. |
| 4 | Return type: **reuse `CustomerSession`** + two optional fields `socialAccessToken?`/`socialIdToken?` (only `socialLogin` sets them). `expires_in` normalized to `number`. No new `AuthContext` kind. |

## Validated Emporix API facts

Researched against developer.emporix.io (official docs).

### Authorization Code / `socialLogin`
- Emporix has **no `/authorize`** endpoint. The browser redirects to the
  **IdP's** `/authorize`; the IdP redirects back to the storefront with
  `?code=…`. The SDK's only Emporix call:
- `POST https://api.emporix.io/customer/{tenant}/socialLogin`
  (operationId `POST-customer-login-customer-by-auth0`).
- Auth header: `Authorization: Bearer {anonymous_access_token}` (required).
- **Query params** (not body): `code` (req), `redirect_uri` (req, must match
  the redirect used at the IdP), `code_verifier` (optional, only if PKCE used).
- Optional request **header** `session-id` to carry the anonymous session.
- Response (all snake_case): `social_access_token`, `social_id_token`,
  `access_token`, `saas_token`, `refresh_token`,
  `refresh_token_expires_in` (**string**), `session_idle_time` (int),
  `token_type`, `expires_in` (**string**), `scope`.
  **No `session_id`** in this response.
- IdP registration (Auth0/Keycloak) is a manual Emporix-support provisioning
  step — not an SDK config concern.

### RFC 8693 Token Exchange / `exchangeauthtoken`
- `POST https://api.emporix.io/customer/{tenant}/exchangeauthtoken`
  (operationId `POST-customer-exchange-authtoken`).
- Auth header: anonymous Bearer (required).
- **Emporix-proprietary wire (NOT RFC 8693 form body)** — **query params**:
  `subjectAccessToken` (req, the external IdP JWT — camelCase),
  `config` (optional, site config key e.g. `Site_DE`; non-existent → 400).
- Response (all snake_case): `subject_access_token`, `access_token`,
  `saas_token`, `refresh_token`, `refresh_token_expires_in` (**integer**),
  `session_idle_time` (int), `token_type`, `expires_in` (**integer**),
  `scope`, `session_id` (**present**).
- Trusted-issuer/introspection config is a manual Emporix-support step.

### Platform quirk (must be normalized)
`expires_in` / `refresh_token_expires_in` are **strings** in the `socialLogin`
response but **integers** in `exchangeauthtoken`. The facade normalizes to
`number` via `Number(...)`. `socialLogin` omits `session_id`
(→ `CustomerSession.sessionId` is `undefined`, already optional).

## Architecture

### A. `CustomerSession` (extended)

Add two optional fields (only `socialLogin` populates them); everything else
unchanged so `login`/`refresh`/`socialLogin`/`exchangeToken` share one type:

```ts
export interface CustomerSession {
  customerToken: string;
  saasToken: string;
  refreshToken: string;
  sessionId: string | undefined;
  expiresIn: number | undefined;
  /** Only set by socialLogin: the IdP access/ID tokens echoed by Emporix. */
  socialAccessToken?: string;
  socialIdToken?: string;
}
```

### B. `CustomerService.socialLogin`

```ts
async socialLogin(
  input: { code: string; redirectUri: string; codeVerifier?: string; sessionId?: string },
  auth: AuthContext = { kind: "anonymous" },
): Promise<CustomerSession>
```
- `POST /customer/{tenant}/socialLogin` with query
  `code`, `redirect_uri`, and `code_verifier` (only when provided);
  request header `session-id` only when `input.sessionId` provided.
- snake_case‑first mapping with the deprecated camelCase fallback (same
  pattern as `login`): `customerToken = wire.access_token ?? wire.accessToken ?? ""`,
  `saasToken`, `refreshToken`, `socialAccessToken = wire.social_access_token`,
  `socialIdToken = wire.social_id_token`,
  `expiresIn = wire.expires_in != null ? Number(wire.expires_in) : undefined`,
  `sessionId = wire.session_id` (undefined here).

### C. `CustomerService.exchangeToken`

```ts
async exchangeToken(
  input: { subjectToken: string; config?: string },
  auth: AuthContext = { kind: "anonymous" },
): Promise<CustomerSession>
```
- `POST /customer/{tenant}/exchangeauthtoken` with query
  `subjectAccessToken = input.subjectToken`, and `config` only when provided.
- snake_case mapping; `expiresIn = Number(wire.expires_in)`;
  `sessionId = wire.session_id`; `saasToken` taken from the response (the
  exchange response **does** return a `saas_token`, so unlike `refresh` no
  carry-forward input is needed).

### D. React `useCustomerSession`

Two new actions mirroring `login` (store `customerToken` via
`storage.setCustomerToken`, set `token`/`refreshTok`/`saasTok` state,
invalidate `["emporix","customer"]` and `["emporix","cart"]`):

```ts
socialLogin(input: { code; redirectUri; codeVerifier?; sessionId? }): Promise<void>
exchangeToken(input: { subjectToken; config? }): Promise<void>
```
Added to `CustomerSessionApi`. No `TokenStorage` interface change (reuses the
in-session refresh/saas state introduced for `refreshSession`).

## Components & boundaries

| Unit | Responsibility | Depends on |
|------|----------------|-----------|
| `CustomerService.socialLogin` | code → CustomerSession (anonymous-auth, query params, snake_case+normalize) | `http`, `auth` |
| `CustomerService.exchangeToken` | IdP JWT → CustomerSession (anonymous-auth, `config` optional) | `http`, `auth` |
| `CustomerSession` (type) | shared session shape incl. optional `social*` | — |
| `useCustomerSession` (react) | wire both actions into stored session state | sdk + react-query |

The SDK provides **only** the Emporix calls. IdP redirect/PKCE and IdP/issuer
provisioning are explicitly out of scope (caller/Emporix-support owned).

## Error handling

- Reuse the existing `HttpClient` typed error mapping. Emporix 4xx (invalid
  `code`, mismatched `redirect_uri`, unknown `config`, untrusted issuer,
  consumed one-time code) propagates verbatim as `EmporixAuthError` /
  `EmporixValidationError` — the SDK does not mask or retry these
  (caller-managed result, consistent with `login`).
- Tokens travel only as query params; the logger emits the request **path**,
  never the full URL/query (verified for `logout`/`refresh`), so no token
  leakage in logs.

## Testing

- **SDK (msw):** for each method — anonymous Bearer sent; exact query params
  (`code`/`redirect_uri`/`code_verifier`; `subjectAccessToken`/`config`);
  `session-id` header only when provided; `config` omitted when absent;
  snake_case→`CustomerSession` mapping; **`expires_in` normalized from both a
  string and an integer**; `social*` fields populated by `socialLogin` and
  absent on `exchangeToken`; default `anonymous` auth and explicit override.
- **React (jsdom):** `socialLogin`/`exchangeToken` store the token, set state,
  invalidate `customer`+`cart` queries; coverage ≥80% on `packages/*`.

## Release / docs

- `@viu/emporix-sdk` `minor`, `@viu/emporix-sdk-react` `minor` (changeset).
- `docs/auth.md`: replace the "out of scope" note with the two supported
  flows; document the manual IdP/issuer Emporix-support provisioning and the
  `expires_in` string/integer platform quirk.

## Plan decomposition

One spec → **one phased plan**, branch `feat/sso-token-exchange` from `main`:
1. `CustomerService.socialLogin` + `exchangeToken` + `CustomerSession`
   optional fields + SDK tests.
2. `useCustomerSession` `socialLogin`/`exchangeToken` actions + react tests.
3. `docs/auth.md` + changeset + green gate + finish.

## Out of scope (YAGNI)

- IdP authorize-URL builder and PKCE generation (caller-owned per Decision 1).
- IdP / trusted-issuer provisioning (manual Emporix-support step, no SDK API).
- New `AuthContext` kinds (`raw` + custom `tokenProvider` already cover
  advanced cases; both flows just yield a customer token).
- `social_access_token`/`social_id_token` lifecycle management (exposed
  read-only; refreshing the IdP session is the IdP's concern).
