---
"@viu/emporix-sdk-react": patch
---

fix customer checkout after a page reload: the `saasToken` (checkout `saas-token` header) is now persisted by the storage adapters (`getSaasToken`/`setSaasToken`, key `emporix.saasToken`) and re-hydrated into the customer-session store on load — alongside the already-persisted `refreshToken`. Previously it lived in memory only, so a reload mid-session dropped it and customer checkout 401'd with `"Saas TOKEN is invalid"` (the refresh endpoint cannot re-mint it). The storage methods are optional, so custom adapters are unaffected; the bundled memory/localStorage/cookie adapters all persist it.
