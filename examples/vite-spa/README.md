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

## Run without a token in the browser (BFF mode)

```bash
VITE_EMPORIX_TENANT=mytenant EMPORIX_STOREFRONT_CLIENT_ID=xxx \
  pnpm --filter @viu/emporix-examples-vite-spa dev:bff
```

The same app in the SDK's proxy mode ([`docs/bff.md`](../../docs/bff.md)).
`bff-dev-proxy.ts` is a guest-only Backend for Frontend that runs inside the Vite
dev server. It starts a session with an `HttpOnly` cookie, checks `X-CSRF`,
forwards an allowlist of catalog and cart paths to Emporix, and attaches an
anonymous token it minted itself. The client id is read without the `VITE_`
prefix, so it stays on the server.

The catalog works as before, and no request from the browser carries an
`Authorization` header. There is no login in this mode: the dev proxy has
none, and `useCustomerSession().login` rejects without a `proxySession.login`
to delegate to. Checkout is not on the allowlist, so `/guest` gets a 403. It is
a development aid, not a BFF to deploy.
