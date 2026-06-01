/* eslint-disable no-console */
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://raw.githubusercontent.com/emporix/api-references/refs/heads/main";
const SPECS: Record<string, string> = {
  customer: `${BASE}/companies-and-customers/customer-management/api-reference/api.yml`,
  product: `${BASE}/products-labels-and-brands/product-service/api-reference/api.yml`,
  category: `${BASE}/catalogs-and-categories/category-tree/api-reference/api.yml`,
  cart: `${BASE}/checkout/cart/api-reference/api.yml`,
  checkout: `${BASE}/checkout/checkout/api-reference/api.yml`,
  payment: `${BASE}/checkout/payment-gateway/api-reference/api.yml`,
  price: `${BASE}/prices-and-taxes/price-service/api-reference/api.yml`,
  media: `${BASE}/media/media/api-reference/api.yml`,
  "customer-segment": `${BASE}/companies-and-customers/customer-segments/api-reference/api.yml`,
  configuration: `${BASE}/configuration/configuration-service/api-reference/api.yml`,
  "shopping-list": `${BASE}/checkout/shopping-list/api-reference/api.yml`,
  "ai-rag-indexer": `${BASE}/artificial-intelligence/ai-rag-indexer/api-reference/api.yml`,
  "sequential-id": `${BASE}/utilities/sequential-id/api-reference/api.yml`,
  fee: `${BASE}/checkout/fee/api-reference/api.yml`,
  webhook: `${BASE}/webhooks/webhook-service/api-reference/api.yml`,
  schema: `${BASE}/utilities/schema/api-reference/api.yml`,
};

async function main(): Promise<void> {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "specs");
  await mkdir(dir, { recursive: true });
  for (const [name, url] of Object.entries(SPECS)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${name} spec: ${res.status} ${url}`);
    const yaml = await res.text();
    await writeFile(join(dir, `${name}.yml`), yaml, "utf8");
    console.log(`fetched ${name} (${yaml.length} bytes)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
