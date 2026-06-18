/* eslint-disable no-console */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hashSpec,
  readSpecVersion,
  diffManifest,
  type SyncManifest,
  type SpecManifestEntry,
} from "./sync-manifest";

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
  "order-v2": `${BASE}/orders/order/api-reference/api.yml`,
  returns: `${BASE}/orders/returns/api-reference/api.yml`,
  "sepa-export": `${BASE}/orders/sepa-export/api-reference/api.yml`,
  "indexing-service": `${BASE}/configuration/indexing-service/api-reference/api.yml`,
  "unit-handling-service": `${BASE}/configuration/unit-handling-service/api-reference/api.yml`,
  catalog: `${BASE}/catalogs-and-categories/catalog/api-reference/api.yml`,
  "vendor-service": `${BASE}/companies-and-customers/vendor-service/api-reference/api.yml`,
  "pick-pack": `${BASE}/orders/pick-pack/api-reference/api.yml`,
  "customer-service": `${BASE}/companies-and-customers/customer-service/api-reference/api.yml`,
  // The B2B "Customer Management Service" (legal-entities/contacts/locations)
  // lives under the repo's `client-management` dir; the SDK module is `customer-management`.
  "customer-management": `${BASE}/companies-and-customers/client-management/api-reference/api.yml`,
  "approval-service": `${BASE}/companies-and-customers/approval-service/approval-api-reference/api.yml`,
  iam: `${BASE}/users-and-permissions/iam/api-reference/api.yml`,
  availability: `${BASE}/orders/availability/api-reference/api.yml`,
};

async function readManifest(path: string): Promise<SyncManifest | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as SyncManifest;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "specs");
  await mkdir(dir, { recursive: true });
  const manifestPath = join(dir, ".sync-manifest.json");
  const prev = await readManifest(manifestPath);
  const now = new Date().toISOString();
  const services: Record<string, SpecManifestEntry> = {};
  for (const [name, url] of Object.entries(SPECS)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${name} spec: ${res.status} ${url}`);
    const yaml = await res.text();
    await writeFile(join(dir, `${name}.yml`), yaml, "utf8");
    services[name] = { url, specVersion: readSpecVersion(yaml), fetchedAt: now, sha256: hashSpec(yaml) };
    console.log(`fetched ${name} (${yaml.length} bytes)`);
  }
  const next: SyncManifest = { generatedAt: now, services };
  const changed = diffManifest(prev, next);
  await writeFile(manifestPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  if (!prev) {
    console.log(`wrote initial sync manifest (${Object.keys(services).length} services)`);
  } else if (changed.length) {
    console.log(`changed since last vendored: ${changed.join(", ")}`);
  } else {
    console.log("no spec changes since last vendored");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
