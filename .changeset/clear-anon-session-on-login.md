---
"@viu/emporix-sdk-react": patch
---

Clear the anonymous (guest) session from storage on customer login. Once a customer token is set the anonymous session is dormant — `useReadAuth` always prefers the customer token — but it lingered in storage (`emporix.anonymousSession`) for the whole authenticated session. `useCustomerSession.login` (and the shared `applySession` path used by `socialLogin` / `exchangeToken`) now call `storage.setAnonymousSession(null)`, so only the customer session remains after login.
