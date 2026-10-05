# Emporix SDK — Next.js App Router example

Next.js 16 App Router (React 19): RSC catalog read through
[`@viu/emporix-sdk-next`](../../packages/next), client-side cart hooks, and a
customer login Server Action (`loginAction` in `app/actions.ts`) that writes an
httpOnly cookie, which the root layout hydrates into the provider via
`initialCustomerToken`. No page calls the action yet.

- `/` — the catalog, a tagged RSC read through `getEmporixClient`
- `/product/[id]` — SSR `prefetchProduct` + `HydrationBoundary`, read on the
  client by `useProduct`
- `/cart` — `useActiveCart({ create: true })` + `useCartCommands`: add a priced
  product, change quantities, remove lines
- `/checkout` — `useCheckout().placeOrder` with demo data, for a cart id you
  paste in
- `/guest-checkout` — guest cart through `useCart` + `useCreateCart`, an add
  through `useCartCommands`, then `useCheckout`; places a real order

Server-side wiring lives in [`app/emporix.ts`](./app/emporix.ts) — one place
mapping this app's `NEXT_PUBLIC_*` names onto `getEmporixClient`. The request
context both sides bind (site, currency, country, language) and the demo
product live in [`app/site.ts`](./app/site.ts), pinned to the viu tenant. There
is no module-scope `EmporixClient` in any server file; the factory memoizes per
process. `app/providers.tsx` still constructs one, because that is the
browser-side client.

## Run

```bash
NEXT_PUBLIC_EMPORIX_TENANT=mytenant NEXT_PUBLIC_EMPORIX_STOREFRONT_CLIENT_ID=xxx \
  pnpm --filter @viu/emporix-examples-next-app-router dev
```

Or put both in an untracked `.env.local`. On another tenant, adapt `app/site.ts`
first: `/cart` and `/guest-checkout` add a hard-coded viu product priced in that
context, so they cannot work there as-is.

`pnpm --filter @viu/emporix-examples-next-app-router build` runs `next build`
(Turbopack by default in Next 16; needs the full Next toolchain — not part of the
library CI gate).

Note that every route builds as dynamic: the root layout reads cookies via
`emporixSession()`, which makes the whole tree dynamic. So `next build` never
calls Emporix — use `next start` or `next dev` with reachable credentials to
exercise the real request path.
