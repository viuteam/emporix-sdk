---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add customer token refresh. `customers.refresh({ refreshToken, saasToken?,
legalEntityId? }, auth?)` calls `GET /customer/{tenant}/refreshauthtoken`
(authorized with an anonymous token, default), returning a new
`CustomerSession` with the **same `sessionId`**. The refresh endpoint does
not return a `saas_token`, so the original is carried forward via the
`saasToken` input. `useCustomerSession` now captures the refresh/saas tokens
at `login`, exposes `refreshToken`, and adds a `refreshSession()` action
that exchanges the refresh token and updates the stored customer token.
