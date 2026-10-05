# Storefront demo redesign: neutral look, site-driven prices, accordion checkout

**Status:** design, not implemented.
**Scope:** `examples/storefront-demo` only. No change to `packages/*`,
`examples/shared`, `next-server-first`, the Angular demo or `vite-spa`. Examples are in the changeset `ignore` list, so nothing is released;
both PRs carry the `no-release` label.
**Decided:** 2026-10-05, in a brainstorming session with mockups. The mockups
used live tenant data and stay out of the repo; the decisions they settled are
recorded below.

## Why

### The look does not fit the data

`src/styles/tokens.css` is «Editorial Luxe»: cream paper, a Fraunces display
serif up to 5.2rem, one oxblood accent, 3:4 portrait tiles in an asymmetric grid.
It needs strong product photography and a price on every product. Emporix tenants
are often B2B, and products without an image, or without a price in the current
context, are normal there. Measured on the viu test tenant on 2026-10-05
(read-only, anonymous storefront token, nothing written):

| | Default site | A second, B2B site |
|---|---|---|
| Products | 928 | 928 |
| With an image (Cloudinary URL, found by `imageOf`) | 403 | 403 |
| With a price in the site's context | 19 | 70 |
| With an image **and** a price | 3 | 52 |
| Delivery methods for CH | one, free | standard CHF 12.90 (free from CHF 150), express CHF 39.00; a separate zone for LI |
| Payment modes | `invoice` | `invoice` |

Three things in the demo make that worse than it has to be:

- **Prices hide behind a collapsed section.** They resolve only when the session
  context carries a currency and a country, and both fields sit under
  «Advanced (optional)» on the setup screen. Skip it and the shop shows no price
  at all; `ProductCard` then renders nothing in the price slot.
- **The home page ignores prices.** `pages/Home.tsx` shows the tenant's first
  twelve products (`useProducts({ pageSize: 12 })`) whether or not they have a
  price.
- **The category bar cannot hold the tree.** The tenant has 26 root categories
  from several projects, one name three times, and `CategoryNav` lays them out in
  one row.

`next-server-first` dropped the same look for the same reason; see the header of
its `app/styles/tokens.css`.

### Accessibility

- `--muted` (`#8a8175`) on `--paper` measures **3.47:1**, and 3.12:1 on
  `--paper-2`. WCAG AA asks 4.5:1 for normal text. This colour carries every field
  label, eyebrow and hint, at 11–15px in letter-spaced capitals.
- Inputs are a bottom border only: `--line-2` on `--paper` is **1.44:1**, where
  WCAG 1.4.11 asks 3:1 for the boundary of a control.
- **208 inline `style={{…}}` in 43 files** bypass the tokens, so replacing the
  tokens alone does not restyle the demo.

### The checkout (`pages/Checkout.tsx`)

1. One long form: no steps, no review before «Place order».
2. Prefilled with invented data (`Guest` / `Shopper`, a street in Zürich). A real
   order with fake data is one click away.
3. No address field is required. The country is free text (`placeholder="CH"`),
   although the delivery options are resolved from it.
4. **The payment amount is not what the order costs.** «Total» and
   `paymentMethods[0].amount` (which `checkout.yml` defines as "Amount to be paid
   by the customer") are both `cart.totalPrice`. A live cart on the B2B site
   (2026-10-05, after the first version of this spec) showed what that is: the
   items **net** plus Emporix's own delivery estimate **net** (the zone's first
   method, CHF 12.90), without VAT — CHF 14.98 for two items worth CHF 2.08. The
   summary then lists the chosen delivery fee on top, and a shopper who picks
   express still pays the standard estimate. On a site with free delivery and
   tax-inclusive prices the numbers happen to agree, which is why it never showed.
   What Emporix accepts as the amount is confirmed by one real order, see
   [Verification](#verification).
5. Totals read `cart.totalPrice`, which the cart spec marks deprecated. The same
   live cart returned `calculatedPrice` with `price` (items: net 2.08, gross 2.14,
   VAT 2.5 %), `totalShipping` (the estimate: net 12.90, gross 13.94, VAT 8.1 %)
   and `finalPrice` (net 14.98, gross 16.08) — `finalPrice` contains the delivery
   estimate. `discountedPrice` and `totalDiscount` are absent without discounts.
   The demo uses none of it.
6. A signed-in customer loses the `saasToken` on reload, because it lives in
   memory only. The form still renders; only «Place order» fails.
7. Payment modes render as `code · integrationType`. The confirmation shows the
   order id only, and its «View order» link sends a guest to the sign-in page,
   because `OrderDetail` sits behind `RequireAuth`.

## Decisions

| Question | Decision | Rejected |
|---|---|---|
| Visual direction | A neutral shop that works with any tenant's data | viu branding; repairing «Editorial Luxe» in place |
| Look | «Clean» (white, one blue accent, chips), plus two parts of «Compact»: the category sidebar on category and search pages, and the article number on product cards | «Compact» on its own; «Warm» (needs strong photography; a tab row cannot hold 26 categories) |
| Images and prices | The setup lets the user pick a site; the price context is derived from it; an optional featured category fills the home page; priced products come first | Env defaults (never reach the GitHub Pages build); adding prices to the tenant (separate work, needs admin access, and the e2e suite runs against that tenant) |
| Checkout layout | Accordion: one route, one open step, finished steps collapse | A wizard with a route per step; one page with every section open |

## Design

### 1. Design system and shell

**Tokens** (`src/styles/tokens.css`). The palette is replaced; contrast measured
against white unless noted:

| Token | Value | Use | Contrast |
|---|---|---|---|
| `--bg` | `#ffffff` | page | |
| `--surface` | `#f6f7f9` | utility bar, summary, sidebar | |
| `--text` | `#111827` | body text | 17.74:1 |
| `--text-2` | `#4b5563` | secondary text, hints | 7.56:1 (7.05:1 on `--surface`) |
| `--accent` | `#1d4ed8` | buttons, links, selected state | 6.70:1 (6.25:1 on `--surface`); white text on it 6.70:1 |
| `--accent-soft` | `#eff4ff` | selected radio card | accent text on it 6.08:1 |
| `--line` | `#e5e7eb` | dividers, card borders (decorative) | |
| `--control` | `#6b7280` | input, select and radio borders | 4.83:1 (4.51:1 on `--surface`), above the 3:1 for controls |
| `--success` / `--success-soft` | `#065f46` / `#ecfdf5` | completed step, free-delivery hint | 7.68:1; 7.29:1 on soft |
| `--warning` / `--warning-soft` | `#92400e` / `#fffbeb` | live-order alert | 6.84:1 on soft |
| `--danger` / `--danger-soft` | `#b91c1c` / `#fef2f2` | errors | 6.47:1; 5.91:1 on soft |

- The spacing scale (`--s-1` … `--s-8`), the type scale (`--step--2` …
  `--step-4`), `--gutter` and `--maxw` keep their names, so inline styles in files
  the redesign does not touch keep working. The old colour names (`--paper*`,
  `--ink*`, `--oxblood*`, `--muted`, `--line-2`, `--good`) are removed, and every
  use is migrated; a grep for them must come back empty.
- Radius: 8px for controls, 12px for cards and panels. No shadows beyond a
  hairline on the sticky summary.
- One family: Hanken Grotesk, already a dependency. `@fontsource-variable/fraunces`
  and its two imports in `main.tsx` go.

**Base styles** (`src/styles/global.css`): boxed inputs with a visible label in
sentence case (no letter-spaced capitals), a 2px accent focus ring, solid /
outline / ghost buttons, chips, radio cards, alerts. `catalog.css` keeps the
catalogue, product page and cart rules, rewritten for the new grid.

**Components** (`src/components/ui`): `Button`, `Field` / `SelectField`, `Tag`,
`Spinner` and `EmptyState` are restyled. Two are new:

- `RadioCard`: a labelled `<input type="radio">` inside a bordered card, with an
  optional description and a right-hand value (a price). Used for sites, saved
  addresses, delivery methods and payment modes.
- `Alert`: `role="alert"` or `role="status"` box in the warning, danger or
  success tone. Replaces the two hand-styled «Live order» boxes.

**Shell** (`src/app`):

- A utility bar (site, currency and language switchers) above the main bar (the
  wordmark «Demo Store», search, account, cart with its count).
- Home: a short intro line naming the tenant and the site, category chips (the
  first roots plus «All categories»), the featured grid. The editorial `Hero`
  goes.
- Category and search pages: a left sidebar with the category tree, the current
  branch expanded. Below 48rem it collapses behind a «Categories» button.
- The telemetry HUD stays, restyled.

**Product card** (`src/catalog/ProductCard.tsx`): square media (`object-fit:
contain` on white), the article number (`code`), the name clamped to two lines,
then the price, or «No price in this context» and no add button. A neutral
placeholder when there is no image. The `no. 01` index and the lead tile go.

**Product page:** gallery, article number, price, quantity, «Add to cart». When
the site's context resolves no price the button is disabled, with a line saying
the price depends on the selected site.

**Inline styles** are replaced by classes in every file the redesign touches.

**Unchanged:** the routes, the account pages (restyled through tokens and
components only), every SDK hook and the cart command chains.

### 2. Setup, site and prices

**Setup in two steps** (`src/config/SetupScreen.tsx`):

1. **Connect.** Tenant and storefront client id; the host stays under
   «Advanced». «Connect» builds a throwaway `EmporixClient` without a context,
   which signs in anonymously and calls `sites.list()` and `categories.tree()`.
   A wrong tenant or client id now fails here, with a message, instead of
   somewhere inside the shop.
2. **Choose a site.** One `RadioCard` per site: name, code, currency and ship-to
   countries (country names from `Intl.DisplayNames`, no extra request); the
   default site is preselected. Below it, an optional «Featured category», a
   select over the tree's roots.

- Saving derives `currency` from `site.currency` and `targetLocation` from
  `site.homeBase.address.country`. That is the derivation `SiteContextProvider`
  already performs (`packages/react/src/site-context.tsx`). The currency and
  country fields disappear from the setup.
- The shop's client is then built with `{ siteCode, currency, targetLocation }`,
  so the anonymous login binds the site's price context. That is how the
  read-only check above got its 70 prices.
- `DemoConfig` gains `featuredCategoryId?: string`. Storage stays
  `localStorage["emporix.demo.config"]`. No tenant, site or category value is
  committed anywhere.
- The footer's «Change tenant» becomes «Change setup» and returns to step 1.

**Prices in the shop:**

- Home «Featured»: `useProductsInCategory(featuredCategoryId)` when a category is
  set, otherwise today's `useProducts({ pageSize: 12 })`.
- Grids (home, category, search) put priced products first, as a stable sort
  within the loaded page. A `ponytail:` comment names the ceiling: a priced
  product on page 2 does not move up; the upgrade path is a price match over
  more than one page.
- Without a price: «No price in this context» on the card, a disabled «Add to
  cart» on the product page.

**Switching the site at runtime:**

- The header switcher stays and calls `useSiteContext().setSite`.
- `setCurrency` re-binds the anonymous price context
  (`client.setStorefrontContext`); `setSite` only PATCHes the session context,
  which the SDK's own comment calls a no-op before a cart exists. Whether a guest
  without a cart gets re-priced is checked in the live check. If not:
  - the demo writes the new site's `{ siteCode, currency, targetLocation }` into
    `DemoConfig` and rebuilds the client, the same path the setup takes;
  - the SDK gets its own fix in a separate PR, outside this redesign.
- Either path clears the stored cart id, because carts are bound to site and
  currency. `setSite` does that already; the rebuild path must too.

### 3. Checkout

```
┌ Demo Store · Checkout ───────────────────────────── ← Back to cart ┐
│ ✓ Contact            anna@example.com · guest            Edit      │ ┌ Order summary ─────────┐
│ ✓ Shipping address   A. Muster, Musterstrasse 1, Zürich  Edit      │ │ ▢ Name  Art. 1050…     │
│ ┌ 3 Delivery ──────────────────────────────────────────────────┐   │ │   20 × CHF 0.92  18.47 │
│ │ (•) Standard delivery (1-2 business days)      CHF 12.90     │   │ │ Subtotal excl. 108.25  │
│ │     Free from CHF 150.00                                     │   │ │ Delivery excl.  12.90  │
│ │ ( ) Express (emergency, same day)              CHF 39.00     │   │ │ VAT              3.75  │
│ │ [ Continue to payment ]                                      │   │ │ Add CHF 41.75 for free │
│ └──────────────────────────────────────────────────────────────┘   │ │ Total          124.90  │
│ 4 Payment                                                          │ └────────────────────────┘
│ 5 Review & place order                                             │
└────────────────────────────────────────────────────────────────────┘
```

One route, `/checkout`, and one open step at a time. «Continue» validates the open
step before the next one opens; a finished step collapses to a one-line summary
with «Edit». The step is not part of the URL.

| # | Step | Content | Complete when |
|---|---|---|---|
| 1 | Contact | Guest: email, first and last name, all required, nothing prefilled; «Sign in» opens a login form inside the step. Signed in: a card with name and email. Signed in but without a `saasToken`: a sign-in form, because the order cannot be placed without one. | A valid email and both names; for a customer, a `saasToken` |
| 2 | Shipping address | Signed in: saved addresses as `RadioCard`s, the default preselected, «New address» opens the form. Otherwise the form (`AddressFields`). Required: contact name (defaulted from step 1), street, postcode, city, country. The country is a select over the active site's `shipToCountries`. | All required fields set |
| 3 | Delivery | `RadioCard`s from `useShippingZones`, `resolveZone(zones, country)`, the fee from `pickFee(fees, subtotal)`. «Free from CHF 150.00» when a higher tier costs 0. No method for the destination: today's free fallback (`methodId: "free"`), stated in the step instead of silently. | A method chosen, or the fallback in effect |
| 4 | Payment | `RadioCard`s from `usePaymentModes`, labelled from `code` (`invoice` → «Invoice»). «Billing address same as shipping», on by default; off opens a second address block that works like step 2 (saved addresses or the form). No mode: today's `custom` fallback, stated in the step. | A mode or the fallback; a valid billing address |
| 5 | Review & place order | The four summaries with «Edit», the live-order `Alert`, «Place order · CHF 121.15». | — |

- **Returning customers start at the review.** When the profile, a default
  address, a delivery method and a payment mode all resolve, steps 1–4 start
  complete, with the first delivery method and payment mode preselected, and
  step 5 is open. This removes the accordion's cost for repeat orders.
- **Summary** (`OrderSummary`): sticky on the right; on narrow screens a
  collapsible bar above the steps showing the total. Lines show image, article
  number, `quantity × unit price` and the line total; below them subtotal,
  discount (when non-zero), delivery, VAT, the free-delivery hint and the total.
  On a site whose prices exclude tax (`site.includesTax` is `false`, as on the
  B2B site) subtotal and delivery are labelled «excl. VAT» and the VAT is its own
  line; otherwise they are gross and the VAT shows as «incl. VAT».
- **Totals** are one pure function, `checkoutTotals(cart, delivery, includesTax)`
  in `src/checkout/totals.ts`, built on what the live cart returned:
  - items, net and gross, from `calculatedPrice.discountedPrice` or `.price`;
  - the delivery **replaces** the cart's estimate: the chosen method's fee is the
    net amount (as the cart treated the standard fee), taxed at the rate the cart
    applied to its estimate (`totalShipping`); before a method is chosen, the
    cart's estimate stands in;
  - `tax` is the VAT on items plus delivery, `total` the gross sum;
  - the free-delivery threshold and `pickFee` compare against the items net on a
    tax-exclusive site and gross otherwise;
  - without `calculatedPrice` it falls back to `subTotalPrice` (items) and shows
    no VAT line.

  **The payment amount is `total`: gross, with the chosen delivery.**
- **Cart page:** its summary moves onto the same function, with the cart's
  estimate as the delivery, so cart and checkout show the same numbers. (PR 1
  shows the cart's own subtotal, estimate and `totalPrice` in the meantime.)
- **Line details:** the cart GET returns an empty `product`, so
  `src/lib/useProductNames.ts` is extended to return name, image and code per
  product id from the same `searchByIds` call.
- **Confirmation:** order number, lines, shipping address, delivery method and
  totals, rendered from a snapshot taken just before submit, since the cart is
  closed afterwards. «View order» only for a signed-in customer; a guest gets
  «Continue shopping».
- **Errors:** a failed submit shows an `Alert` in step 5, not only a toast, and
  keeps every input. A `404` (the cart is gone) and a `409` (an order already
  exists for this cart) get their own text and a link back to the cart.
- **The request is otherwise unchanged:** `customer.id` plus the `saasToken`
  header for a customer, `guest: true` for a guest, a SHIPPING and a BILLING
  address, one payment method.

**Code layout:** `pages/Checkout.tsx` owns the data hooks, the step state and the
submit. `src/checkout/` holds `CheckoutStep` (the accordion shell),
`ContactStep`, `AddressStep` (from `AddressSection` and `AddressFields`),
`DeliveryStep` (from `ShippingSelector`), `PaymentStep` (from
`PaymentSelector`), `ReviewStep`, `OrderSummary` and `totals.ts`.

## Delivery

1. **PR 1, design system, setup and catalogue:** tokens, base styles,
   components, shell and sidebar, the two-step setup, product card, product page,
   home, the cart and account pages in the new look, Fraunces removed, the demo's
   README (setup steps, layout section) updated.
2. **PR 2, checkout:** the accordion, summary, totals, confirmation, error states
   and the payment amount. Stacked on PR 1.

Both touch examples only: no changeset, `no-release` label. Merging deploys the
GitHub Pages build (`.github/workflows/pages.yml`), so between the two merges the
public demo shows the old checkout flow in the new look.

## Verification

Per PR:

- `pnpm build`, `pnpm typecheck`, and
  `pnpm -F @viu/emporix-examples-storefront-demo build`.
- A grep for the removed colour names returns nothing. A one-off script, not
  committed, measures every text/background token pair (≥ 4.5:1) and the control
  border (≥ 3:1); its output goes into the PR.
- No unit tests, following the repo's rule that examples are verified by
  typecheck, build and running them (`examples/shared/package.json`). The totals
  are checked live instead, against real carts: free delivery on the default
  site; CHF 12.90, CHF 39.00 and free from CHF 150 on the B2B site.
- **Live check** in the browser pane, at desktop width and at 375px. The user
  submits the setup form; the agent does not type the client id. Then: setup →
  site → a category with prices → product page → cart → checkout as a guest up to
  step 5, without placing an order. Screenshots go into the PR. The same pass
  reads `calculatedPrice` from a live cart and tests the runtime site switch.
  Adding to the cart creates a cart on the tenant, as any visit does.
- **One real order** on the B2B site with standard delivery, to confirm that
  Emporix accepts the gross total, delivery included, as the payment amount. Only
  on the user's explicit go-ahead at that moment.
- **Customer flow:** the user signs in; the agent does not type passwords. A
  reload must then lead to the sign-in form in step 1.

## Open questions, answered during implementation

| Question | Answer |
|---|---|
| Which `calculatedPrice` fields does a live cart return? | **Answered in the PR 1 live check (2026-10-05).** `price`, `shipping`, `totalShipping` and `finalPrice`, each with net, gross, tax and rate; `finalPrice` contains Emporix's delivery estimate; prices on the B2B site are net (`includesTax: false`). This reshaped the totals above. |
| Does `setSite` re-price a guest? | **Answered in the PR 1 live check.** Yes, immediately (the visitor already has a cart by then). It also showed the switch outliving a reload on the server while the page fell back to the setup's site; fixed in PR 1 by persisting site, currency and country, and by dropping the guest session on «Change setup». No SDK change needed. |
| Does Emporix accept the gross total, delivery included, as the payment amount? | Open: the one real order in PR 2. If it rejects it, send what it accepts and document why. |

## Out of scope

- `packages/*`, `next-server-first`, `angular-storefront-demo`, `vite-spa` (the
  e2e suite's app) and the e2e suite itself.
- Adding prices or media to any tenant.
- A CMS-like home page, dark mode, B2B company switching, payment-provider
  redirects (3-D Secure, PayPal): none exists in the demo today, and none is added.
