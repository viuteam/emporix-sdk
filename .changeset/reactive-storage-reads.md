---
"@viu/emporix-sdk-react": patch
---

make auth/cart state reads reactive: all render-time `storage.getCustomerToken()`/`getCartId()` reads now go through `useSyncExternalStore`-backed snapshots. Login/logout and cart-id writes immediately re-render dependent hooks — previously `enabled` gates (e.g. `usePaymentModes`, `useMyCompanies`, order hooks) stayed stale until an unrelated re-render, and sibling components could tear under concurrent rendering. Storage adapters without `subscribe`/`subscribeAll` behave as before (non-reactive).
