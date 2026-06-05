---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

feat: invoke Emporix cloud functions

Adds `client.cloudFunctions.invoke<TRes, TReq>(functionId, { method?, path?,
body?, query?, headers? }, auth)` — a generic call to tenant cloud functions
(`/cloud-functions/{tenant}/functions/{id}[/sub]`), with GET/POST/PUT/DELETE and
service / customer / anonymous / raw auth (default anonymous). Adds the React
hooks `useInvokeCloudFunction` (mutation, any method) and `useCloudFunction`
(GET-style query with caching), both with auto-auth (customer-if-token-else-
anonymous) and an optional override.
