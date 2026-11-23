/**
 * The vendored Emporix specs: service name -> raw URL in `emporix/api-references`.
 *
 * A module of its own, with no side effects: `fetch-specs.ts` runs the sync when
 * it is loaded, so a test that needs the list (`tests/spec-patches.test.ts`)
 * imports it from here. Importing it from `fetch-specs.ts` re-downloaded every
 * spec during `pnpm test`, and failed without network.
 */

const BASE = "https://raw.githubusercontent.com/emporix/api-references/refs/heads/main";
export const SPECS: Record<string, string> = {
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
  "import-service": `${BASE}/utilities/import-service/api-reference/api.yml`,
  "search-service": `${BASE}/utilities/search-service/api-reference/api.yml`,
  "audit-logs-changelog": `${BASE}/utilities/audit-logs-changelog/api-reference/api.yml`,
  coupon: `${BASE}/rewards-and-promotions/coupon/api-reference/api.yml`,
  "reward-points": `${BASE}/rewards-and-promotions/reward-points/api-reference/api.yml`,
  "brand-service": `${BASE}/products-labels-and-brands/brand-service/api-reference/api.yml`,
  "label-service": `${BASE}/products-labels-and-brands/label-service/api-reference/api.yml`,
  "country-service": `${BASE}/configuration/country-service/api-reference/api.yml`,
  "currency-service": `${BASE}/configuration/currency-service/api-reference/api.yml`,
  shipping: `${BASE}/delivery-and-shipping/shipping/api-reference/api.yml`,
  "order-v2": `${BASE}/orders/order/api-reference/api.yml`,
  returns: `${BASE}/orders/returns/api-reference/api.yml`,
  "indexing-service": `${BASE}/configuration/indexing-service/api-reference/api.yml`,
  "unit-handling-service": `${BASE}/configuration/unit-handling-service/api-reference/api.yml`,
  catalog: `${BASE}/catalogs-and-categories/catalog/api-reference/api.yml`,
  "vendor-service": `${BASE}/companies-and-customers/vendor-service/api-reference/api.yml`,
  "customer-service": `${BASE}/companies-and-customers/customer-service/api-reference/api.yml`,
  // The B2B "Customer Management Service" (legal-entities/contacts/locations)
  // lives under the repo's `client-management` dir; the SDK module is `customer-management`.
  "customer-management": `${BASE}/companies-and-customers/client-management/api-reference/api.yml`,
  "approval-service": `${BASE}/companies-and-customers/approval-service/approval-api-reference/api.yml`,
  iam: `${BASE}/users-and-permissions/iam/api-reference/api.yml`,
  availability: `${BASE}/orders/availability/api-reference/api.yml`,
  // Upstream serves these five with an `api.yaml` (not `.yml`) extension for
  // three of them — mind the extension when editing.
  "oauth-service": `${BASE}/authentication/oauth-service/api-reference/api.yml`,
  "site-settings-service": `${BASE}/configuration/site-settings-service/api-reference/api.yml`,
  invoice: `${BASE}/orders/invoice/api-reference/api.yaml`,
  quote: `${BASE}/quotes/quote/api-reference/api.yaml`,
  "session-context": `${BASE}/users-and-permissions/session-context/api-reference/api.yaml`,
};
