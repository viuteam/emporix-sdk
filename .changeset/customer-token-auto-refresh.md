---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add opt-in reactive customer-token auto-refresh.

Core: `EmporixClient.setCustomerTokenRefresher(refresher)` registers a
single-flight `CustomerTokenRefresher`; on a `customer`-kind 401 the HTTP layer
refreshes once and retries. Off by default — the customer token stays
caller-owned.

React: `EmporixProvider` gains `autoRefreshCustomerToken` and
`onCustomerSessionExpired`. When enabled, a customer 401 is transparently
refreshed via the stored refresh token (anonymous-authorized
`GET /refreshauthtoken`) and the request is retried; B2B `legalEntityId` is
preserved.
