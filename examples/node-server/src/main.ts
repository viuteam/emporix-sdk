/* eslint-disable no-console */
import { EmporixClient, auth } from "@viu/emporix-sdk";

/**
 * Plain Node usage (no React): proves the core SDK works standalone for
 * backend tasks such as catalog sync. Run with: pnpm --filter
 * @viu/emporix-examples-node-server start
 */
async function main(): Promise<void> {
  const tenant = process.env.EMPORIX_TENANT ?? "mytenant";
  const sdk = new EmporixClient({
    tenant,
    credentials: {
      backend: {
        clientId: process.env.EMPORIX_BACKEND_CLIENT_ID ?? "",
        secret: process.env.EMPORIX_BACKEND_CLIENT_SECRET ?? "",
      },
      storefront: { clientId: process.env.EMPORIX_STOREFRONT_CLIENT_ID ?? "" },
    },
    logger: { level: "info" },
  });

  // Anonymous catalog read.
  const page = await sdk.products.list({ pageSize: 10 });
  console.log(`Fetched ${page.items.length} products for tenant "${tenant}"`);

  // Service-account write context (example only — no call made).
  const serviceCtx = auth.service();
  console.log(`Service context kind: ${serviceCtx.kind}`);

  // Stream the whole catalog lazily.
  let count = 0;
  for await (const _product of sdk.products.listAll({ pageSize: 50 })) {
    count += 1;
    if (count >= 100) break; // cap the demo
  }
  console.log(`Iterated ${count} products via listAll()`);
}

main().catch((err) => {
  console.error("example failed:", err);
  process.exit(1);
});
