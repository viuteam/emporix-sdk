# Emporix SDK — Vite SPA example

Pure client-side React app: anonymous catalog browse and customer login with
the token persisted in `localStorage` (anonymous→login→cart-merge handled by
the SDK on login).

## Run

```bash
VITE_EMPORIX_TENANT=mytenant VITE_EMPORIX_STOREFRONT_CLIENT_ID=xxx \
  pnpm --filter @viu/emporix-examples-vite-spa dev
```
