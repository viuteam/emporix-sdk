---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add Emporix customer SSO support. `customers.socialLogin({ code, redirectUri,
codeVerifier?, sessionId? })` performs the Authorization-Code code exchange
(`POST /customer/{tenant}/socialLogin`); `customers.exchangeToken({
subjectToken, config? })` performs the RFC 8693 token exchange
(`POST /customer/{tenant}/exchangeauthtoken`). Both default to anonymous auth
and return a `CustomerSession` (now with optional `socialAccessToken` /
`socialIdToken` from socialLogin); `expires_in` is normalized to a number
across both flows. `useCustomerSession` gains `socialLogin` and
`exchangeToken` actions that store the session like `login`.
