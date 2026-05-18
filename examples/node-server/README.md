# Emporix SDK — Node server example

Plain Node.js usage of `@viu/emporix-sdk` (no React). Demonstrates anonymous
catalog reads, a service auth context, and `listAll()` streaming.

## Run

```bash
cp ../../packages/sdk/.env.example .env   # fill in real credentials
pnpm --filter @viu/emporix-examples-node-server start
```

Environment variables: `EMPORIX_TENANT`, `EMPORIX_BACKEND_CLIENT_ID`,
`EMPORIX_BACKEND_CLIENT_SECRET`, `EMPORIX_STOREFRONT_CLIENT_ID`.
