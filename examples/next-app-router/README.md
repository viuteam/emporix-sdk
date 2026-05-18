# Emporix SDK — Next.js App Router example

Next.js 14 App Router: RSC catalog (SDK called directly on the server),
client-side cart hooks, and a customer login Server Action that sets an
httpOnly cookie hydrated into the provider via `initialCustomerToken`.

## Run

```bash
NEXT_PUBLIC_EMPORIX_TENANT=mytenant NEXT_PUBLIC_EMPORIX_STOREFRONT_CLIENT_ID=xxx \
  pnpm --filter @viu/emporix-examples-next-app-router dev
```

`pnpm --filter @viu/emporix-examples-next-app-router build` runs `next build`
(needs the full Next toolchain; not part of the library CI gate).
