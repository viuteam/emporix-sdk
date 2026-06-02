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
  "tax-service": `${BASE}/prices-and-taxes/tax-service/api-reference/api.yml`,
  media: `${BASE}/media/media/api-reference/api.yml`,
  "customer-segment": `${BASE}/companies-and-customers/customer-segments/api-reference/api.yml`,
  configuration: `${BASE}/configuration/configuration-service/api-reference/api.yml`,
  "ai-service": `${BASE}/artificial-intelligence/ai-service/api-reference/api.yml`,
  "shopping-list": `${BASE}/checkout/shopping-list/api-reference/api.yml`,
  "ai-rag-indexer": `${BASE}/artificial-intelligence/ai-rag-indexer/api-reference/api.yml`,
  "sequential-id": `${BASE}/utilities/sequential-id/api-reference/api.yml`,
  fee: `${BASE}/checkout/fee/api-reference/api.yml`,
  webhook: `${BASE}/webhooks/webhook-service/api-reference/api.yml`,
  schema: `${BASE}/utilities/schema/api-reference/api.yml`,
  coupon: `${BASE}/rewards-and-promotions/coupon/api-reference/api.yml`,
  "reward-points": `${BASE}/rewards-and-promotions/reward-points/api-reference/api.yml`,
  "brand-service": `${BASE}/products-labels-and-brands/brand-service/api-reference/api.yml`,
  "label-service": `${BASE}/products-labels-and-brands/label-service/api-reference/api.yml`,
  "country-service": `${BASE}/configuration/country-service/api-reference/api.yml`,
  "currency-service": `${BASE}/configuration/currency-service/api-reference/api.yml`,
  shipping: `${BASE}/delivery-and-shipping/shipping/api-reference/api.yml`,
  returns: `${BASE}/orders/returns/api-reference/api.yml`,
  "sepa-export": `${BASE}/orders/sepa-export/api-reference/api.yml`,
  "indexing-service": `${BASE}/configuration/indexing-service/api-reference/api.yml`,
  "unit-handling-service": `${BASE}/configuration/unit-handling-service/api-reference/api.yml`,
  catalog: `${BASE}/catalogs-and-categories/catalog/api-reference/api.yml`,
  "vendor-service": `${BASE}/companies-and-customers/vendor-service/api-reference/api.yml`,
  "pick-pack": `${BASE}/orders/pick-pack/api-reference/api.yml`,
  "customer-service": `${BASE}/companies-and-customers/customer-service/api-reference/api.yml`,
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
