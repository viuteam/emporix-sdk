---
"@viu/emporix-sdk-react": patch
---

fix(react): share the customer session across hook instances

`useCustomerSession` kept its session in a per-instance `useState`. The
`token` slot was mirrored from storage (so `isAuthenticated` was consistent),
but the in-memory `saasToken` and `refreshToken` lived only in the component
instance that called `login()`. A different consumer — e.g. the checkout page
reading `saasToken` for the `saas-token` header — saw `null`, so customer
checkout failed with `401 "Saas TOKEN is invalid"`.

The session now lives in a shared, per-storage store consumed via
`useSyncExternalStore`, so every `useCustomerSession()` reads the same
`{ token, refreshToken, saasToken }`. A login in one component is immediately
visible to all others. The tokens remain in-memory only (still cleared on a
full reload, by design).
