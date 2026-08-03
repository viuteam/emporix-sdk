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

The `start` script passes `--env-file=.env`, and without it the two lines above
were a lie: `tsx` does not read `.env` on its own, so the example silently ran
against the fallback tenant `mytenant` with empty credentials. Measured
2026-08-03 — `tsx -e 'console.log(process.env.EMPORIX_TENANT)'` printed
`undefined` with a populated `.env` sitting next to it.

The flag makes the file **required**: Node exits with `ENOENT` if it is missing.
That is the better failure — the alternative is the silent one above.
