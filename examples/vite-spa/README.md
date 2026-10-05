# Emporix SDK — Vite SPA example

Pure client-side React app: anonymous catalog browse and customer login with
the token persisted in `localStorage` (anonymous→login→cart-merge handled by
the SDK on login).

- `/` — the catalog (`useProducts`)
- `/account` — customer login and logout (`useCustomerSession`)
- `/account/orders` — the customer's orders, paged (`useMyOrdersInfinite`)
- `/account/orders/:id` — one order, with cancel and reorder (`useOrder`,
  `useCancelOrder`, `useReorder`)
- `/guest` — guest cart and checkout: `useCreateCart`, an add through
  `useCartCommands`, then `useCheckout`. **It places a real order.**

The nav carries a B2B company badge and, for a customer with assigned companies,
a switcher (`useActiveCompany`, `useCompanySwitcher`). A telemetry HUD fed by
`EmporixProvider`'s `onTelemetry` sits in the corner; press `?` to toggle it.

## Run

```bash
VITE_EMPORIX_TENANT=mytenant VITE_EMPORIX_STOREFRONT_CLIENT_ID=xxx \
  pnpm --filter @viu/emporix-examples-vite-spa dev
```

`/guest` works on the viu tenant only: it adds a hard-coded viu product, priced
in the context `src/main.tsx` binds (CHF, `main`, CH).

This is also the app `pnpm e2e` boots — port 5173, tenant `viu` unless
`VITE_EMPORIX_TENANT` is set; see [`docs/e2e.md`](../../docs/e2e.md).
