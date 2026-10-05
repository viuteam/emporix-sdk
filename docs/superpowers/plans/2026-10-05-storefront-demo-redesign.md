# Storefront Demo Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `examples/storefront-demo` a neutral look that works with any tenant's data, make prices appear by deriving the price context from a site chosen in the setup, and replace the one-form checkout with a five-step accordion whose total and payment amount include delivery.

**Architecture:** Two stacked PRs on `feat/storefront-demo-redesign`. PR 1 (Tasks 1–9) replaces the colour tokens and base styles while keeping the class names the account pages use, adds two primitives, rebuilds the shell, turns the setup into two steps and reworks the catalogue. PR 2 (Tasks 10–16) adds a pure totals function, one component per checkout step, and rewrites `pages/Checkout.tsx` as the orchestrator.

**Tech Stack:** React 19, React Router 7, Vite 8, TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), `@viu/emporix-sdk`, `@viu/emporix-sdk-react`, `@viu/emporix-examples-shared`, plain CSS with custom properties, `@fontsource-variable/hanken-grotesk`.

**Spec:** `docs/superpowers/specs/2026-10-05-storefront-demo-redesign-design.md` (commit `2b657f6`). Read it before Task 1; this plan argues from it.

## Global Constraints

- Everything committed is **English**: code, comments, UI strings, commit messages, PR bodies.
- Commit subjects: `type(scope): lowercase verb …`, scope `examples` (or `docs`). Body lines at most 100 characters (commitlint `body-max-line-length`), so the bodies below are wrapped inside their quotes. No `#123` in a body line; use a `Refs: #123` trailer. End every commit with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Only `examples/storefront-demo/**` changes, plus `pnpm-lock.yaml` for the font removal. Not `packages/*`, not `examples/shared`, not another example.
- TypeScript: optional component props are typed `prop?: T | undefined` (callers pass values that may be `undefined`); type-only imports use `import type`; indexing an array yields `T | undefined`.
- Colours only through tokens from `src/styles/tokens.css`; every text pair ≥ 4.5:1, control borders ≥ 3:1 (values in the spec).
- No unit tests: the repo verifies examples by typecheck, build and running them (`examples/shared/package.json`). Each task's gate is typecheck + build (+ greps where stated).
- The agent never types the storefront client id or a password into the browser, and never places an order without the user's explicit go-ahead **at that moment**.
- No tenant, site or category name of the test tenant is committed (in particular not the B2B site's code).
- PRs carry the `no-release` label and no changeset; PR 2 is stacked on PR 1.
- `.claude/launch.json` is local and untracked: use it, never commit it.

**Commands used throughout** (from the repo root):

```bash
pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build   # once, before the first typecheck: examples compile against dist/
pnpm -F @viu/emporix-examples-storefront-demo typecheck
pnpm -F @viu/emporix-examples-storefront-demo build
```

## File Structure

All paths below are relative to `examples/storefront-demo/`.

| Path | Status | Responsibility |
|---|---|---|
| `src/styles/tokens.css` | rewrite (T1) | palette, type and space scale, radius, shadow |
| `src/styles/global.css` | rewrite (T1) | reset, type, layout helpers, buttons, fields, chips, surfaces, alert, radio card, spinner |
| `src/styles/shell.css` | create (T3, T4) | header, footer, toasts, telemetry, sign-in card, setup screen |
| `src/styles/catalog.css` | rewrite (T5, T6) | pages, chips, sidebar and tree, product grid and card, product page, quantity stepper, cart page |
| `src/styles/checkout.css` | create (T11) | accordion, forms, review, order summary, confirmation |
| `src/main.tsx` | modify (T1, T3, T11) | font and stylesheet imports |
| `package.json` | modify (T1) | drop `@fontsource-variable/fraunces` |
| `src/components/ui/Alert.tsx` | create (T2) | tinted, announced message box |
| `src/components/ui/RadioCard.tsx` | create (T2) | radio input inside a bordered card |
| `src/components/ui/{Field,Spinner,EmptyState}.tsx` | modify (T2) | inline styles → classes |
| `src/app/{Header,Footer,AppShell,CartBadge,AccountMenu,SiteCurrencySwitcher,LanguageSwitcher,Toasts,TelemetryHUD}.tsx` | modify (T3) | new shell |
| `src/account/AuthTabs.tsx` | modify (T3) | inline styles → classes |
| `src/lib/countries.ts` | create (T4) | `countryName(code)` via `Intl.DisplayNames` |
| `src/config/connect.ts` | create (T4) | throwaway anonymous client: sites + category roots; `siteContext(site)` |
| `src/config/useDemoConfig.ts` | modify (T4) | `featuredCategoryId` |
| `src/config/ConfigGate.tsx` | modify (T8 only) | hands `save` to the app for the site switch |
| `src/config/SetupScreen.tsx` | rewrite (T4) | two-step setup |
| `src/catalog/useAddToCart.ts` | create (T5) | the add-to-cart chain, shared by grid and product page |
| `src/catalog/ProductCard.tsx`, `ProductGrid.tsx`, `CategoryNav.tsx`, `AddToCartBar.tsx` | rewrite (T5) | cards with code, price or «No price…», add button; priced first; chips |
| `src/catalog/CategorySidebar.tsx` | create (T5) | `CategoryTree` + `CategorySidebar` |
| `src/catalog/{ProductGallery,VariantPicker}.tsx` | modify (T5) | inline styles → classes |
| `src/catalog/Hero.tsx` | delete (T5) | editorial hero |
| `src/pages/{Home,Category,Search,Product}.tsx` | rewrite/modify (T5) | new layouts |
| `src/pages/Categories.tsx` | create (T5) | «All categories» |
| `src/App.tsx` | modify (T5, T8) | routes, `Home` props, provider key (T8 only) |
| `src/lib/useProductNames.ts` | modify (T6) | `useProductDetails` (name, image, code) + `useProductNames` on top |
| `src/pages/Cart.tsx` | modify (T6) | classes, «cart» wording, images and article numbers |
| `src/checkout/totals.ts` | create (T10) | `checkoutTotals`, `freeFrom`, `DeliveryChoice`, `CheckoutTotals` |
| `src/checkout/CheckoutStep.tsx`, `OrderSummary.tsx` | create (T11) | accordion shell, summary |
| `src/checkout/ContactStep.tsx` | create (T12) | step 1 |
| `src/checkout/AddressFields.tsx` | modify (T13) | country select, errors, helpers |
| `src/checkout/AddressPicker.tsx`, `AddressStep.tsx` | create (T13) | saved cards + form; step 2 |
| `src/checkout/DeliveryStep.tsx`, `PaymentStep.tsx` | create (T14) | steps 3 and 4 |
| `src/checkout/ReviewStep.tsx`, `Confirmation.tsx` | create (T15) | step 5, after-order page |
| `src/pages/Checkout.tsx` | modify (T2), rewrite (T15) | orchestrator |
| `src/checkout/{AddressSection,ShippingSelector,PaymentSelector}.tsx` | delete (T15) | replaced |
| `README.md` | modify (T9, T16) | setup, flows, layout |

---

# PR 1 — Design system, setup and catalogue

### Task 1: Design tokens and base styles

**Files:**
- Rewrite: `src/styles/tokens.css`, `src/styles/global.css`
- Modify: `src/main.tsx`, `package.json`, `pnpm-lock.yaml` (via `pnpm install`)
- Modify (token rename only): `src/app/Toasts.tsx`, `src/app/TelemetryHUD.tsx`, `src/app/Header.tsx`, `src/account/AuthTabs.tsx`, `src/catalog/Hero.tsx`, `src/components/ui/Spinner.tsx`, `src/config/SetupScreen.tsx`, `src/pages/Checkout.tsx`, `src/styles/catalog.css`

**Interfaces:**
- Produces the tokens every later task uses: `--bg`, `--surface`, `--text`, `--text-2`, `--accent`, `--accent-hover`, `--accent-soft`, `--line`, `--control`, `--success`, `--success-soft`, `--warning`, `--warning-soft`, `--warning-line`, `--danger`, `--danger-soft`, `--font-body`, `--step--2` … `--step-4`, `--s-1` … `--s-8`, `--gutter`, `--maxw`, `--radius`, `--radius-lg`, `--line-w`, `--shadow-1`, `--shadow-2`, `--ease`, `--dur`.
- Produces the classes later tasks use: `.container .stack .cluster .center-col .rule .sr-only .eyebrow .muted .price .u-underline .btn .btn--accent .btn--solid .btn--outline .btn--ghost .btn--sm .btn--block .field .field__label .field__control .input .field__error .field__hint .tag .tag--accent .surface .alert .alert--warning .alert--danger .alert--success .radio-list .radio-card .radio-card__title .radio-card__desc .radio-card__value .spinner .loading .empty-state`.

- [ ] **Step 1: Replace `src/styles/tokens.css`**

```css
/* Design tokens: a neutral shop that works with any tenant's data.
   Every text colour meets WCAG AA on the backgrounds it is used on, and the
   control border meets 3:1; the measured ratios are in
   docs/superpowers/specs/2026-10-05-storefront-demo-redesign-design.md. */
:root {
  /* Palette */
  --bg: #ffffff;
  --surface: #f6f7f9;
  --text: #111827;
  --text-2: #4b5563;
  --accent: #1d4ed8;
  --accent-hover: #1e40af;
  --accent-soft: #eff4ff;
  --line: #e5e7eb;
  --control: #6b7280;
  --success: #065f46;
  --success-soft: #ecfdf5;
  --warning: #92400e;
  --warning-soft: #fffbeb;
  --warning-line: #fcd34d;
  --danger: #b91c1c;
  --danger-soft: #fef2f2;

  /* Type: one family */
  --font-body: "Hanken Grotesk Variable", "Hanken Grotesk", system-ui, sans-serif;

  /* Fluid type scale. The names predate the redesign; inline styles use them. */
  --step--2: clamp(0.75rem, 0.73rem + 0.1vw, 0.8rem);
  --step--1: clamp(0.85rem, 0.82rem + 0.15vw, 0.9rem);
  --step-0: clamp(0.95rem, 0.92rem + 0.15vw, 1rem);
  --step-1: clamp(1.1rem, 1.04rem + 0.3vw, 1.25rem);
  --step-2: clamp(1.35rem, 1.22rem + 0.6vw, 1.75rem);
  --step-3: clamp(1.6rem, 1.4rem + 1vw, 2.25rem);
  --step-4: clamp(1.9rem, 1.6rem + 1.5vw, 2.75rem);

  /* Space. The names predate the redesign; inline styles use them. */
  --s-1: 0.25rem;
  --s-2: 0.5rem;
  --s-3: 0.75rem;
  --s-4: 1rem;
  --s-5: 1.5rem;
  --s-6: 2.5rem;
  --s-7: 4rem;
  --s-8: 6rem;
  --gutter: clamp(1rem, 0.6rem + 2vw, 2rem);
  --maxw: 80rem;

  --radius: 8px;
  --radius-lg: 12px;
  --line-w: 1px;
  --shadow-1: 0 1px 2px rgba(17, 24, 39, 0.06);
  --shadow-2: 0 12px 32px -12px rgba(17, 24, 39, 0.28);

  --ease: ease;
  --dur: 0.15s;
}
```

- [ ] **Step 2: Replace `src/styles/global.css`**

```css
/* Base styles: reset, type, layout helpers and primitives.

   Most class names predate the redesign (`.eyebrow`, `.muted`, `.surface`,
   `.u-underline`, …) and keep working with the new look, which is how the
   account pages restyle without edits. `.serif`, `.index` and `.reveal` are left
   without rules on purpose: harmless leftovers in files the redesign does not
   rewrite. */

*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
}
html {
  -webkit-text-size-adjust: 100%;
}
body {
  min-height: 100dvh;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-body);
  font-size: var(--step-0);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
img,
picture,
svg {
  display: block;
  max-width: 100%;
}
button,
input,
select,
textarea {
  font: inherit;
  color: inherit;
}
a {
  color: inherit;
  text-decoration: none;
}
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
code {
  font-size: 0.9em;
}

h1,
h2,
h3,
h4 {
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.01em;
}
h1 {
  font-size: var(--step-4);
}
h2 {
  font-size: var(--step-3);
}
h3 {
  font-size: var(--step-2);
}
h4 {
  font-size: var(--step-1);
}

/* Layout helpers */
.container {
  width: 100%;
  max-width: var(--maxw);
  margin-inline: auto;
  padding-inline: var(--gutter);
}
.stack > * + * {
  margin-top: var(--s-4);
}
.cluster {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-3);
}
.center-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.rule {
  border: 0;
  border-top: var(--line-w) solid var(--line);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

/* Text helpers */
.eyebrow {
  font-size: var(--step--1);
  font-weight: 600;
  color: var(--text-2);
}
.muted {
  color: var(--text-2);
}
.price {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.u-underline {
  color: var(--accent);
  font-weight: 600;
}
.u-underline:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

/* Buttons */
.btn {
  --btn-bg: var(--text);
  --btn-fg: var(--bg);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--s-2);
  padding: 0.6em 1.1em;
  border: var(--line-w) solid var(--btn-bg);
  border-radius: var(--radius);
  background: var(--btn-bg);
  color: var(--btn-fg);
  font-size: var(--step--1);
  font-weight: 600;
  cursor: pointer;
  transition: background var(--dur) var(--ease), border-color var(--dur) var(--ease);
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn--accent {
  --btn-bg: var(--accent);
  --btn-fg: #ffffff;
}
.btn--accent:hover:not(:disabled) {
  --btn-bg: var(--accent-hover);
}
.btn--solid:hover:not(:disabled) {
  --btn-bg: var(--text-2);
}
.btn--outline {
  background: transparent;
  color: var(--text);
  border-color: var(--control);
}
.btn--outline:hover:not(:disabled) {
  border-color: var(--text);
}
.btn--ghost {
  background: transparent;
  border-color: transparent;
  color: var(--accent);
  padding-inline: 0.5em;
}
.btn--ghost:hover:not(:disabled) {
  text-decoration: underline;
}
.btn--sm {
  padding: 0.4em 0.75em;
  font-size: var(--step--2);
}
.btn--block {
  width: 100%;
}

/* Fields: boxed, with a visible label */
.field {
  display: flex;
  flex-direction: column;
  gap: var(--s-1);
}
.field__label {
  font-size: var(--step--1);
  font-weight: 600;
  color: var(--text);
}
.field__control,
.input {
  width: 100%;
  background: var(--bg);
  border: var(--line-w) solid var(--control);
  border-radius: var(--radius);
  padding: 0.55em 0.7em;
  font-size: var(--step-0);
}
.field__control:focus,
.input:focus {
  outline: 2px solid var(--accent);
  outline-offset: 0;
  border-color: var(--accent);
}
.field__control[aria-invalid="true"] {
  border-color: var(--danger);
}
.field__control:disabled {
  background: var(--surface);
  color: var(--text-2);
}
.field__error {
  font-size: var(--step--1);
  color: var(--danger);
}
.field__hint {
  font-size: var(--step--1);
  color: var(--text-2);
}

/* Chips */
.tag {
  display: inline-flex;
  align-items: center;
  gap: var(--s-1);
  padding: 0.3em 0.75em;
  border: var(--line-w) solid var(--line);
  border-radius: 999px;
  background: var(--bg);
  color: var(--text);
  font-size: var(--step--1);
}
.tag--accent {
  background: var(--text);
  border-color: var(--text);
  color: var(--bg);
  cursor: pointer;
}

/* Surfaces */
.surface {
  background: var(--bg);
  border: var(--line-w) solid var(--line);
  border-radius: var(--radius-lg);
}

/* Alert (components/ui/Alert.tsx) */
.alert {
  border: var(--line-w) solid;
  border-radius: var(--radius);
  padding: var(--s-3) var(--s-4);
  font-size: var(--step--1);
}
.alert--warning {
  color: var(--warning);
  background: var(--warning-soft);
  border-color: var(--warning-line);
}
.alert--danger {
  color: var(--danger);
  background: var(--danger-soft);
  border-color: currentColor;
}
.alert--success {
  color: var(--success);
  background: var(--success-soft);
  border-color: currentColor;
}

/* Radio card (components/ui/RadioCard.tsx) */
.radio-list {
  display: grid;
  gap: var(--s-2);
}
.radio-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: var(--s-3);
  align-items: center;
  padding: var(--s-3) var(--s-4);
  border: var(--line-w) solid var(--control);
  border-radius: var(--radius);
  background: var(--bg);
  cursor: pointer;
}
.radio-card:has(input:checked) {
  border-color: var(--accent);
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.radio-card input {
  width: 1.1em;
  height: 1.1em;
  accent-color: var(--accent);
}
.radio-card__title {
  display: block;
  font-weight: 600;
}
.radio-card__desc {
  display: block;
  font-size: var(--step--1);
  color: var(--text-2);
}
.radio-card__value {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

/* Spinner, loading row, empty state */
@keyframes spin {
  to {
    transform: rotate(1turn);
  }
}
.spinner {
  display: inline-block;
  width: 1.1em;
  height: 1.1em;
  border: 2px solid var(--line);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation-duration: 2s;
  }
}
.loading {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: var(--s-3);
  padding: var(--s-7) 0;
  color: var(--text-2);
}
.empty-state {
  padding: var(--s-7) 0;
  gap: var(--s-3);
}
.empty-state p {
  max-width: 40ch;
}
```

- [ ] **Step 3: Rename the old colour tokens everywhere they are still used**

Run from the repo root:

```bash
cd examples/storefront-demo/src && sed -i '' -E \
  -e 's/var\(--paper-[23]\)/var(--surface)/g' \
  -e 's/var\(--paper\)/var(--bg)/g' \
  -e 's/var\(--ink-2\)/var(--text-2)/g' \
  -e 's/var\(--ink\)/var(--text)/g' \
  -e 's/var\(--oxblood-2\)/var(--accent-hover)/g' \
  -e 's/var\(--oxblood\)/var(--accent)/g' \
  -e 's/var\(--muted\)/var(--text-2)/g' \
  -e 's/var\(--line-2\)/var(--control)/g' \
  -e 's/var\(--good\)/var(--success)/g' \
  app/Toasts.tsx app/TelemetryHUD.tsx app/Header.tsx account/AuthTabs.tsx catalog/Hero.tsx \
  components/ui/Spinner.tsx config/SetupScreen.tsx pages/Checkout.tsx styles/catalog.css; cd -
```

Then, in `src/app/Toasts.tsx`, an error is not an accent — change the border expression:

```tsx
              borderLeft: `3px solid ${t.kind === "error" ? "var(--danger)" : t.kind === "success" ? "var(--success)" : "var(--text-2)"}`,
```

(It previously read `"var(--accent)"` for errors after the rename. Task 3 replaces these inline styles with classes; this keeps the intermediate commit correct.)

- [ ] **Step 4: Drop the serif font**

In `src/main.tsx` delete these two lines:

```tsx
import "@fontsource-variable/fraunces";
import "@fontsource-variable/fraunces/wght-italic.css";
```

In `package.json` delete the line `"@fontsource-variable/fraunces": "^5.2.9",`. Then from the repo root:

```bash
pnpm install
git diff --stat pnpm-lock.yaml
```

Expected: `pnpm-lock.yaml` changes only by the removed `@fontsource-variable/fraunces` entries.

- [ ] **Step 5: Gate — no old colour token is left**

```bash
grep -rnE -- "--(paper|ink|oxblood|muted|good|line-2)\b" examples/storefront-demo/src || echo "ok: no old colour tokens"
```

Expected: `ok: no old colour tokens`.

- [ ] **Step 6: Gate — contrast, measured from the file**

This script is not committed; paste its output into the PR 1 body.

```bash
node --input-type=module -e '
import { readFileSync } from "node:fs";
const css = readFileSync("examples/storefront-demo/src/styles/tokens.css", "utf8");
const v = (n) => css.match(new RegExp(`--${n}:\\s*(#[0-9a-f]{6})`, "i"))[1];
const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const pairs = [["text","bg",4.5],["text-2","bg",4.5],["text-2","surface",4.5],["accent","bg",4.5],["accent","surface",4.5],["accent","accent-soft",4.5],["control","bg",3],["control","surface",3],["success","bg",4.5],["success","success-soft",4.5],["warning","warning-soft",4.5],["danger","bg",4.5],["danger","danger-soft",4.5]];
let bad = 0;
for (const [f, b, min] of pairs) { const r = ratio(v(f), v(b)); if (r < min) bad++; console.log(`${f} on ${b}: ${r.toFixed(2)} (min ${min})${r < min ? "  FAIL" : ""}`); }
for (const n of ["accent", "accent-hover"]) { const r = ratio("#ffffff", v(n)); if (r < 4.5) bad++; console.log(`white on ${n}: ${r.toFixed(2)} (min 4.5)`); }
process.exit(bad ? 1 : 0);'
```

Expected (exit 0): `text on bg: 17.74`, `text-2 on bg: 7.56`, `text-2 on surface: 7.05`, `accent on bg: 6.70`, `accent on surface: 6.25`, `accent on accent-soft: 6.08`, `control on bg: 4.83`, `control on surface: 4.51`, `success on bg: 7.68`, `success on success-soft: 7.29`, `warning on warning-soft: 6.84`, `danger on bg: 6.47`, `danger on danger-soft: 5.91`, `white on accent: 6.70`, `white on accent-hover: 8.72`.

- [ ] **Step 7: Typecheck and build**

```bash
pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build
pnpm -F @viu/emporix-examples-storefront-demo typecheck
pnpm -F @viu/emporix-examples-storefront-demo build
```

Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add examples/storefront-demo pnpm-lock.yaml
git commit -m "feat(examples): give the storefront demo a neutral design system" \
  -m "Replaces the «Editorial Luxe» palette, which failed AA for labels (3.47:1)
and for input borders (1.44:1), with a neutral one. Keeps the spacing and type
scale names so untouched inline styles keep working, and drops the serif font." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: UI primitives

**Files:**
- Create: `src/components/ui/Alert.tsx`, `src/components/ui/RadioCard.tsx`
- Modify: `src/components/ui/Field.tsx:25`, `src/components/ui/Spinner.tsx:5-12`, `src/components/ui/EmptyState.tsx`, `src/pages/Checkout.tsx` (the «Live order.» box)

**Interfaces:**
- Consumes: `.alert*`, `.radio-card*`, `.field__hint`, `.loading`, `.empty-state` from Task 1.
- Produces:
  - `Alert({ tone: "warning" | "danger" | "success"; children: ReactNode })`
  - `RadioCard({ name: string; value: string; checked: boolean; onChange: (value: string) => void; title: ReactNode; description?: ReactNode | undefined; aside?: ReactNode | undefined })`

- [ ] **Step 1: Create `src/components/ui/Alert.tsx`**

```tsx
import type { ReactNode } from "react";

type Tone = "warning" | "danger" | "success";

/**
 * A tinted box for things the shopper must not miss. Warnings and errors are
 * announced (`role="alert"`); a success is polite (`role="status"`).
 */
export function Alert({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <div className={`alert alert--${tone}`} role={tone === "success" ? "status" : "alert"}>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Create `src/components/ui/RadioCard.tsx`**

```tsx
import type { ReactNode } from "react";

/**
 * A radio button inside a bordered card, for sites, saved addresses, delivery
 * methods and payment modes. The whole card is the label, so a click anywhere
 * selects it; the checked card is highlighted by `.radio-card:has(input:checked)`.
 */
export function RadioCard({
  name,
  value,
  checked,
  onChange,
  title,
  description,
  aside,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  title: ReactNode;
  description?: ReactNode | undefined;
  aside?: ReactNode | undefined;
}) {
  return (
    <label className="radio-card">
      <input type="radio" name={name} value={value} checked={checked} onChange={() => onChange(value)} />
      <span>
        <span className="radio-card__title">{title}</span>
        {description ? <span className="radio-card__desc">{description}</span> : null}
      </span>
      <span className="radio-card__value">{aside}</span>
    </label>
  );
}
```

- [ ] **Step 3: `src/components/ui/Field.tsx` — the hint becomes a class**

Replace line 25:

```tsx
      {!error && hint ? <span className="muted" style={{ fontSize: "var(--step--1)" }}>{hint}</span> : null}
```

with:

```tsx
      {!error && hint ? <span className="field__hint">{hint}</span> : null}
```

- [ ] **Step 4: `src/components/ui/Spinner.tsx` — `Loading` uses `.loading`**

Replace the `Loading` function (lines 5–12) with:

```tsx
export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="loading">
      <Spinner label={label} />
      <span>{label}</span>
    </div>
  );
}
```

- [ ] **Step 5: Replace `src/components/ui/EmptyState.tsx`**

```tsx
import type { ReactNode } from "react";

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="center-col empty-state">
      <h2 className="page-title">{title}</h2>
      {children ? <p className="muted">{children}</p> : null}
    </div>
  );
}
```

(`.page-title` arrives with Task 5's `catalog.css`; until then the `h2` default applies.)

- [ ] **Step 6: `src/pages/Checkout.tsx` — the live-order box becomes an `Alert`**

Add the import next to the other UI imports:

```tsx
import { Alert } from "../components/ui/Alert";
```

Replace the whole block (as it reads after Task 1's rename):

```tsx
      <div
        role="alert"
        style={{
          border: "1px solid var(--accent)",
          borderRadius: "var(--radius-lg)",
          padding: "var(--s-4)",
          marginBottom: "var(--s-6)",
          background: "color-mix(in oklab, var(--accent) 7%, var(--bg))",
        }}
      >
        <strong className="serif" style={{ color: "var(--accent)" }}>Live order.</strong>{" "}
        <span className="muted">Placing this order creates a real order in tenant <strong>{client.tenant}</strong>.</span>
      </div>
```

with:

```tsx
      <div style={{ marginBottom: "var(--s-6)" }}>
        <Alert tone="warning">
          <strong>Live order.</strong> Placing this order creates a real order in tenant <strong>{client.tenant}</strong>.
        </Alert>
      </div>
```

`Checkout.tsx` is only patched in PR 1; Task 15 rewrites it, inline styles included.

- [ ] **Step 7: Typecheck and build**

```bash
pnpm -F @viu/emporix-examples-storefront-demo typecheck
pnpm -F @viu/emporix-examples-storefront-demo build
```

Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add examples/storefront-demo/src
git commit -m "feat(examples): add alert and radio-card primitives to the storefront demo" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: App shell

**Files:**
- Create: `src/styles/shell.css`
- Modify: `src/main.tsx`, `src/app/Header.tsx`, `src/app/SiteCurrencySwitcher.tsx`, `src/app/LanguageSwitcher.tsx`, `src/app/CartBadge.tsx`, `src/app/AccountMenu.tsx`, `src/app/Footer.tsx`, `src/app/AppShell.tsx`, `src/app/Toasts.tsx`, `src/app/TelemetryHUD.tsx`, `src/account/AuthTabs.tsx`

**Interfaces:**
- Consumes: tokens and primitives from Task 1.
- Produces: `.site-header`, `.utility-bar`, `.main-bar`, `.wordmark`, `.switcher`, `.cart-link`, `.site-main`, `.site-footer`, `.toasts`, `.toast`, `.telemetry*`, `.auth-card`, `.auth-tabs`, `.auth-tab`. Component props unchanged except `Footer`'s button label («Change setup»).

- [ ] **Step 1: Create `src/styles/shell.css`**

```css
/* App shell: header, footer, toasts, telemetry, sign-in card. */

.site-header {
  position: sticky;
  top: 0;
  z-index: 30;
  background: var(--bg);
  border-bottom: var(--line-w) solid var(--line);
}
.utility-bar {
  background: var(--surface);
  font-size: var(--step--1);
}
.utility-bar__inner {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: var(--s-2);
  min-height: 2rem;
}
.switcher {
  border: 0;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-2);
  font-size: var(--step--1);
  padding: 0.2em 0.35em;
  cursor: pointer;
}
.switcher:hover {
  color: var(--text);
}
.main-bar {
  display: flex;
  align-items: center;
  gap: var(--s-4);
  padding-block: var(--s-3);
}
.wordmark {
  font-weight: 700;
  font-size: var(--step-1);
  white-space: nowrap;
}
.main-bar__search {
  flex: 1;
  max-width: 28rem;
}
.main-bar__nav {
  display: flex;
  align-items: center;
  gap: var(--s-4);
  margin-left: auto;
  font-size: var(--step--1);
  font-weight: 600;
}
.main-bar__link:hover,
.cart-link:hover {
  color: var(--accent);
}
.cart-link {
  display: inline-flex;
  align-items: center;
  gap: var(--s-1);
}
.cart-link__count {
  min-width: 1.5em;
  padding: 0 0.4em;
  border-radius: 999px;
  background: var(--accent);
  color: #ffffff;
  font-size: var(--step--2);
  text-align: center;
}
@media (max-width: 40rem) {
  .main-bar {
    flex-wrap: wrap;
  }
  .main-bar__search {
    order: 3;
    flex-basis: 100%;
    max-width: none;
  }
}

.site-main {
  min-height: 62vh;
}

.site-footer {
  border-top: var(--line-w) solid var(--line);
  margin-top: var(--s-8);
}
.site-footer__inner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-3);
  padding-block: var(--s-5);
  font-size: var(--step--1);
}
.site-footer__reset {
  margin-left: auto;
}

/* Toasts */
.toasts {
  position: fixed;
  right: var(--gutter);
  bottom: var(--s-5);
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
  max-width: min(92vw, 26rem);
}
.toast {
  background: var(--text);
  color: var(--bg);
  border-left: 4px solid var(--text-2);
  border-radius: var(--radius);
  padding: var(--s-3) var(--s-4);
  box-shadow: var(--shadow-2);
  font-size: var(--step--1);
}
.toast--error {
  border-left-color: var(--danger);
}
.toast--success {
  border-left-color: var(--success);
}

/* Telemetry HUD */
.telemetry {
  position: fixed;
  left: var(--gutter);
  bottom: var(--s-5);
  z-index: 40;
}
.telemetry__toggle {
  background: var(--bg);
}
.telemetry__panel {
  position: absolute;
  bottom: calc(100% + var(--s-2));
  left: 0;
  width: min(86vw, 24rem);
  max-height: 50vh;
  overflow: auto;
  padding: var(--s-3);
  box-shadow: var(--shadow-2);
  font-size: var(--step--2);
  font-variant-numeric: tabular-nums;
}
.telemetry__list {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.telemetry__row {
  display: flex;
  gap: var(--s-3);
  padding: 2px 0;
  border-bottom: var(--line-w) solid var(--line);
}
.telemetry__type {
  color: var(--accent);
  min-width: 9rem;
}
.telemetry__detail {
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Sign-in card (account page) */
.auth-card {
  max-width: 30rem;
  margin-inline: auto;
  padding: var(--s-5);
}
.auth-tabs {
  display: flex;
  gap: var(--s-4);
  margin-bottom: var(--s-4);
  border-bottom: var(--line-w) solid var(--line);
}
.auth-tab {
  margin-bottom: -1px;
  padding: var(--s-2) 0;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--text-2);
  font-weight: 600;
  cursor: pointer;
}
.auth-tab[aria-selected="true"] {
  color: var(--text);
  border-bottom-color: var(--accent);
}
.auth-card__foot {
  margin-top: var(--s-4);
  font-size: var(--step--1);
  color: var(--text-2);
}
```

In `src/main.tsx`, after `import "./styles/global.css";` add:

```tsx
import "./styles/shell.css";
```

- [ ] **Step 2: Replace `src/app/Header.tsx`**

```tsx
import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { SiteCurrencySwitcher } from "./SiteCurrencySwitcher";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { CartBadge } from "./CartBadge";
import { AccountMenu } from "./AccountMenu";

export function Header() {
  const nav = useNavigate();
  const [q, setQ] = useState("");

  function search(e: FormEvent) {
    e.preventDefault();
    const v = q.trim();
    if (v) nav(`/search?q=${encodeURIComponent(v)}`);
  }

  return (
    <header className="site-header">
      <div className="utility-bar">
        <div className="container utility-bar__inner">
          <SiteCurrencySwitcher />
          <LanguageSwitcher />
        </div>
      </div>
      <div className="container main-bar">
        <Link to="/" className="wordmark">
          Demo Store
        </Link>
        <form onSubmit={search} className="main-bar__search" role="search">
          <input
            className="input"
            type="search"
            placeholder="Search products…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search products"
          />
        </form>
        <nav className="main-bar__nav" aria-label="Account and cart">
          <AccountMenu />
          <CartBadge />
        </nav>
      </div>
    </header>
  );
}
```

- [ ] **Step 3: Switchers lose their inline style object**

In `src/app/SiteCurrencySwitcher.tsx`:
- delete the `const selectStyle = { … };` block (lines 3–11);
- replace the wrapper `<div className="cluster" style={{ gap: "var(--s-1)", alignItems: "center" }}>` with `<div className="cluster">`;
- on both `<select>` elements replace `className="field__control"` and `style={selectStyle}` with `className="switcher"`.

In `src/app/LanguageSwitcher.tsx`: delete the `selectStyle` block (lines 3–11) and replace `className="field__control"` plus `style={selectStyle}` with `className="switcher"`.

- [ ] **Step 4: Replace `src/app/CartBadge.tsx` and `src/app/AccountMenu.tsx`**

```tsx
import { Link } from "react-router-dom";
import { useActiveCart } from "@viu/emporix-sdk-react";

export function CartBadge() {
  const { data: cart } = useActiveCart();
  const count = cart?.items?.length ?? 0;
  return (
    <Link to="/cart" className="cart-link">
      Cart
      {count ? (
        <span className="cart-link__count">
          {count}
          <span className="sr-only"> items</span>
        </span>
      ) : null}
    </Link>
  );
}
```

```tsx
import { Link } from "react-router-dom";
import { useCustomerSession } from "@viu/emporix-sdk-react";

export function AccountMenu() {
  const { isAuthenticated } = useCustomerSession();
  return (
    <Link to="/account" className="main-bar__link">
      {isAuthenticated ? "Account" : "Sign in"}
    </Link>
  );
}
```

- [ ] **Step 5: Replace `src/app/Footer.tsx`; `AppShell` uses `.site-main`**

```tsx
export function Footer({ tenant, onReset }: { tenant: string; onReset: () => void }) {
  return (
    <footer className="site-footer">
      <div className="container site-footer__inner">
        <span className="muted">
          Emporix Storefront Demo · tenant <strong>{tenant}</strong>
        </span>
        <span className="muted">
          Built with <code>@viu/emporix-sdk-react</code>
        </span>
        <button type="button" className="btn btn--ghost btn--sm site-footer__reset" onClick={onReset}>
          Change setup
        </button>
      </div>
    </footer>
  );
}
```

In `src/app/AppShell.tsx` replace `<main style={{ minHeight: "62vh" }}>{children}</main>` with `<main className="site-main">{children}</main>`.

- [ ] **Step 6: `src/app/Toasts.tsx` and `src/app/TelemetryHUD.tsx` use classes**

In `Toasts.tsx` replace the returned toast container (the `<div aria-live="polite" style={…}>` through its closing `</div>`) with:

```tsx
      <div aria-live="polite" className="toasts">
        {toasts.map((t) => (
          <div key={t.id} role={t.kind === "error" ? "alert" : "status"} className={`toast toast--${t.kind}`}>
            {t.message}
          </div>
        ))}
      </div>
```

Replace the `return (…)` of `TelemetryHUD` with:

```tsx
  return (
    <div className="telemetry">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="btn btn--outline btn--sm telemetry__toggle"
        aria-expanded={open}
      >
        ◴ telemetry {events.length ? `(${events.length})` : ""}
      </button>
      {open ? (
        <div className="surface telemetry__panel">
          {events.length === 0 ? (
            <p className="muted">No events yet — interact with the store.</p>
          ) : (
            <ul className="telemetry__list">
              {events.map((e) => (
                <li key={e.id} className="telemetry__row">
                  <span className="telemetry__type">{e.type}</span>
                  <span className="telemetry__detail">{e.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
```

- [ ] **Step 7: `src/account/AuthTabs.tsx` uses classes**

Replace the `return (…)` (lines 47–107) with:

```tsx
  return (
    <div className="surface auth-card">
      <div className="auth-tabs" role="tablist" aria-label="Account">
        {(["login", "signup"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className="auth-tab"
          >
            {t === "login" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="stack">
        <Field
          label="Email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          label="Password"
          type="password"
          required
          autoComplete={tab === "login" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {tab === "signup" ? (
          <Field
            label="Confirm password"
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        ) : null}
        <Button type="submit" variant="accent" block disabled={busy}>
          {busy ? "Please wait…" : tab === "login" ? "Sign in" : "Create account"}
        </Button>
      </form>

      {tab === "login" ? (
        <p className="auth-card__foot">
          Forgot your password? <Link to="/reset-password" className="u-underline">Reset it</Link>.
        </p>
      ) : null}
    </div>
  );
```

- [ ] **Step 8: Gate — no inline style left in the shell files**

```bash
grep -n "style={" examples/storefront-demo/src/app/{Header,Footer,AppShell,CartBadge,AccountMenu,SiteCurrencySwitcher,LanguageSwitcher,Toasts,TelemetryHUD}.tsx examples/storefront-demo/src/account/AuthTabs.tsx || echo "ok: shell has no inline styles"
```

Expected: `ok: shell has no inline styles`.

- [ ] **Step 9: Typecheck, build, commit**

```bash
pnpm -F @viu/emporix-examples-storefront-demo typecheck
pnpm -F @viu/emporix-examples-storefront-demo build
git add examples/storefront-demo/src
git commit -m "feat(examples): rebuild the storefront demo shell" \
  -m "A utility bar for site, currency and language above the wordmark, search,
account and cart. The footer's reset becomes «Change setup»; toasts, telemetry
and the sign-in card move from inline styles to classes." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Two-step setup

**Files:**
- Create: `src/lib/countries.ts`, `src/config/connect.ts`
- Modify: `src/config/useDemoConfig.ts`, `src/styles/shell.css` (append)
- Rewrite: `src/config/SetupScreen.tsx`

**Interfaces:**
- Consumes: `Alert`, `RadioCard` (Task 2); `Field`, `SelectField`, `Button`; `catId`, `catLabel` from `../lib/adapters`; `errorMessage` from `../app/Toasts`.
- Produces:
  - `countryName(code: string): string`
  - `loadTenantChoices(input: { tenant: string; storefrontClientId: string; host?: string | undefined }): Promise<TenantChoices>`, `interface TenantChoices { sites: Site[]; categories: CategoryNode[] }`
  - `siteContext(site: Site): { siteCode: string; currency: string; targetLocation: string }`
  - `DemoConfig.featuredCategoryId?: string`

- [ ] **Step 1: Create `src/lib/countries.ts`**

```ts
const regions = new Intl.DisplayNames(undefined, { type: "region" });

/** The display name of an ISO 3166 country code in the browser's language, or the code itself. */
export function countryName(code: string): string {
  try {
    return regions.of(code) ?? code;
  } catch {
    // `of` throws a RangeError for a malformed code.
    return code;
  }
}
```

- [ ] **Step 2: Create `src/config/connect.ts`**

```ts
import { EmporixClient } from "@viu/emporix-sdk";
import type { CategoryNode, Site } from "@viu/emporix-sdk";

export interface TenantChoices {
  sites: Site[];
  categories: CategoryNode[];
}

/**
 * Signs in anonymously with a throwaway client and reads what the setup offers:
 * the tenant's active sites and the roots of its category tree. A wrong tenant
 * or client id fails here, before the shop renders.
 */
export async function loadTenantChoices(input: {
  tenant: string;
  storefrontClientId: string;
  host?: string | undefined;
}): Promise<TenantChoices> {
  const client = new EmporixClient({
    tenant: input.tenant,
    ...(input.host ? { host: input.host } : {}),
    credentials: { storefront: { clientId: input.storefrontClientId } },
    logger: { level: "warn" },
  });
  const [sites, categories] = await Promise.all([client.sites.list(), client.categories.tree()]);
  return { sites: sites.filter((s) => s.active), categories };
}

/**
 * The price context a site implies: its currency and its home country. The same
 * derivation `SiteContextProvider` makes on a site switch
 * (`packages/react/src/site-context.tsx`).
 */
export function siteContext(site: Site): { siteCode: string; currency: string; targetLocation: string } {
  return { siteCode: site.code, currency: site.currency, targetLocation: site.homeBase.address.country };
}
```

- [ ] **Step 3: `src/config/useDemoConfig.ts` — remember the featured category**

Add to `interface DemoConfig`, after `targetLocation`:

```ts
  /** Category whose products fill the home page; chosen in the setup. */
  featuredCategoryId?: string;
```

Add to `normalizeConfig`, after the `targetLocation` line:

```ts
  if (c.featuredCategoryId?.trim()) out.featuredCategoryId = c.featuredCategoryId.trim();
```

- [ ] **Step 4: Replace `src/config/SetupScreen.tsx`**

```tsx
import { useState } from "react";
import type { FormEvent } from "react";
import { Field, SelectField } from "../components/ui/Field";
import { Button } from "../components/ui/Button";
import { Alert } from "../components/ui/Alert";
import { RadioCard } from "../components/ui/RadioCard";
import { catId, catLabel } from "../lib/adapters";
import { countryName } from "../lib/countries";
import { errorMessage } from "../app/Toasts";
import { isValidTenant, type DemoConfig } from "./useDemoConfig";
import { loadTenantChoices, siteContext, type TenantChoices } from "./connect";

const env = import.meta.env;

/**
 * Step 1 connects (tenant + public client id, checked by an anonymous sign-in);
 * step 2 picks the site, whose currency and home country become the price
 * context, and optionally the category that fills the home page.
 */
export function SetupScreen({ onSubmit }: { onSubmit: (c: DemoConfig) => void }) {
  const [tenant, setTenant] = useState<string>(env.VITE_DEMO_DEFAULT_TENANT ?? "");
  const [clientId, setClientId] = useState<string>(env.VITE_DEMO_DEFAULT_STOREFRONT_CLIENT_ID ?? "");
  const [host, setHost] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [choices, setChoices] = useState<TenantChoices | null>(null);
  const [siteCode, setSiteCode] = useState("");
  const [featured, setFeatured] = useState("");

  const tenantError = touched && !isValidTenant(tenant) ? "Lowercase, 3–16 chars (a–z, 0–9)." : undefined;
  const clientError = touched && !clientId.trim() ? "Required." : undefined;

  async function connect(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!isValidTenant(tenant) || !clientId.trim()) return;
    setBusy(true);
    setConnectError(null);
    try {
      const next = await loadTenantChoices({
        tenant: tenant.trim(),
        storefrontClientId: clientId.trim(),
        host: host.trim() || undefined,
      });
      setChoices(next);
      setSiteCode((next.sites.find((s) => s.default) ?? next.sites[0])?.code ?? "");
    } catch (err) {
      setConnectError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function enter(e: FormEvent) {
    e.preventDefault();
    const site = choices?.sites.find((s) => s.code === siteCode);
    onSubmit({
      tenant,
      storefrontClientId: clientId,
      host,
      ...(site ? siteContext(site) : {}),
      ...(featured ? { featuredCategoryId: featured } : {}),
    });
  }

  return (
    <main className="container setup">
      <p className="eyebrow">Emporix · Storefront Demo</p>
      <h1 className="setup__title">Connect your tenant</h1>
      <p className="muted setup__lead">
        Enter a tenant and its <strong>storefront client id</strong> (public, no secret). Everything runs in your
        browser with anonymous and customer tokens.
      </p>
      <Alert tone="warning">
        <strong>Live tenant.</strong> This demo talks to a real Emporix tenant and can place <strong>real orders</strong>.
        Use a test or sandbox tenant.
      </Alert>

      {choices === null ? (
        <form onSubmit={connect} className="stack setup__form" noValidate>
          <Field
            label="Tenant"
            value={tenant}
            onChange={(e) => setTenant(e.target.value)}
            placeholder="your-tenant"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            error={tenantError}
          />
          <Field
            label="Storefront client id"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="public storefront client id"
            error={clientError}
          />
          <details className="setup__advanced">
            <summary>Advanced (optional)</summary>
            <Field label="Host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="https://api.emporix.io" />
          </details>
          {connectError ? (
            <Alert tone="danger">
              <strong>Couldn't connect.</strong> {connectError}
            </Alert>
          ) : null}
          <div>
            <Button type="submit" variant="accent" disabled={busy}>
              {busy ? "Connecting…" : "Connect"}
            </Button>
          </div>
        </form>
      ) : (
        <form onSubmit={enter} className="stack setup__form">
          <fieldset className="setup__sites">
            <legend className="field__label">Site</legend>
            {choices.sites.length === 0 ? (
              <Alert tone="warning">This tenant reports no active site. You can enter the store, but prices may not resolve.</Alert>
            ) : (
              <div className="radio-list">
                {choices.sites.map((s) => (
                  <RadioCard
                    key={s.code}
                    name="site"
                    value={s.code}
                    checked={siteCode === s.code}
                    onChange={setSiteCode}
                    title={s.name}
                    description={`${s.code} · ${s.currency} · ships to ${s.shipToCountries.map(countryName).join(", ")}`}
                    aside={s.default ? "Default" : undefined}
                  />
                ))}
              </div>
            )}
          </fieldset>
          <SelectField label="Featured category (optional)" value={featured} onChange={(e) => setFeatured(e.target.value)}>
            <option value="">None: show the first products</option>
            {choices.categories.map((c) => (
              <option key={catId(c)} value={catId(c)}>
                {catLabel(c)}
              </option>
            ))}
          </SelectField>
          <p className="field__hint">Fills the home page. Pick a category whose products have a price on this site.</p>
          <div className="cluster">
            <Button type="submit" variant="accent">
              Enter the store
            </Button>
            <Button type="button" variant="ghost" onClick={() => setChoices(null)}>
              Back
            </Button>
          </div>
        </form>
      )}
    </main>
  );
}
```

- [ ] **Step 5: Append the setup styles to `src/styles/shell.css`**

```css
/* Setup screen */
.setup {
  max-width: 44rem;
  padding-block: var(--s-7);
}
.setup__title {
  margin-block: var(--s-2) var(--s-3);
}
.setup__lead {
  max-width: 52ch;
  margin-bottom: var(--s-4);
}
.setup__form {
  margin-top: var(--s-5);
}
.setup__advanced summary {
  cursor: pointer;
  font-weight: 600;
  color: var(--text-2);
  padding-block: var(--s-2);
}
.setup__sites {
  border: 0;
  padding: 0;
}
.setup__sites legend {
  margin-bottom: var(--s-2);
}
```

- [ ] **Step 6: Typecheck, build, commit**

```bash
pnpm -F @viu/emporix-examples-storefront-demo typecheck
pnpm -F @viu/emporix-examples-storefront-demo build
git add examples/storefront-demo/src
git commit -m "feat(examples): pick the site in the storefront demo setup" \
  -m "«Connect» signs in anonymously and lists the tenant's sites. The chosen
site's currency and home country become the price context, so prices resolve
without the hidden currency and country fields. An optional featured category
fills the home page." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

The live run of this screen happens in Task 7 (the user submits it).

---

### Task 5: Catalogue

**Files:**
- Create: `src/catalog/useAddToCart.ts`, `src/catalog/CategorySidebar.tsx`, `src/pages/Categories.tsx`
- Rewrite: `src/catalog/ProductCard.tsx`, `src/catalog/ProductGrid.tsx`, `src/catalog/CategoryNav.tsx`, `src/catalog/AddToCartBar.tsx`, `src/pages/Home.tsx`, `src/styles/catalog.css`
- Modify: `src/pages/Category.tsx`, `src/pages/Search.tsx`, `src/pages/Product.tsx`, `src/catalog/ProductGallery.tsx`, `src/catalog/VariantPicker.tsx`, `src/App.tsx`
- Delete: `src/catalog/Hero.tsx`

**Interfaces:**
- Consumes: `DemoConfig.featuredCategoryId` (Task 4); `toProductCard`, `productYrn`, `catId`, `catLabel`, `PriceVM`, `ProductCardVM` from `../lib/adapters`; `money` from `@viu/emporix-examples-shared`.
- Produces:
  - `useAddToCart(): { add: (productId: string, productName: string, price: PriceVM, quantity: number) => Promise<void>; isPending: boolean }`
  - `ProductCard({ vm: ProductCardVM; price?: PriceVM | undefined; onAdd?: (() => void) | undefined; adding?: boolean })`
  - `ProductGrid({ products: Product[]; priceOf?: ((id: string) => PriceVM | undefined) | undefined })` — the `lead` prop is gone.
  - `CategoryTree({ activeId?: string | undefined })`, `CategorySidebar({ activeId?: string | undefined })`
  - `Home({ tenant: string; featuredCategoryId?: string | undefined })`
  - Classes `.page`, `.page-title`, `.section-head`, `.back-link`, `.chips`, `.with-sidebar`, `.sidebar*`, `.cat-tree*`, `.pc*`, `.pdp*`, `.buy-bar*`, `.qty`.

- [ ] **Step 1: Create `src/catalog/useAddToCart.ts`**

```ts
import { useActiveCart, useCartCommands, useEmporix } from "@viu/emporix-sdk-react";
import { productYrn, type PriceVM } from "../lib/adapters";
import { useToast, errorMessage } from "../app/Toasts";

/**
 * Adds a priced product in one request: the add, then the calculated cart, which
 * the hook writes straight into the cart cache.
 *
 * `create: true` bootstraps the visitor's cart on the first page that offers
 * «Add to cart», once per visitor, as the product page always did. Call this
 * hook once per page (the grid, the buy bar), never per card: twelve cards
 * bootstrapping at the same time would create twelve carts.
 */
export function useAddToCart() {
  const { client } = useEmporix();
  const { data: cart } = useActiveCart({ create: true });
  const cartId = (cart as { id?: string } | null)?.id;
  const chain = useCartCommands(cartId);
  const { notify } = useToast();

  async function add(productId: string, productName: string, price: PriceVM, quantity: number): Promise<void> {
    // Emporix requires a priceId on internal-type cart items.
    if (!price.priceId) return;
    try {
      await chain.mutateAsync({
        commands: [
          {
            type: "AddCartItem",
            data: {
              itemYrn: productYrn(client.tenant, productId),
              quantity,
              price: {
                priceId: price.priceId,
                originalAmount: price.amount,
                effectiveAmount: price.amount,
                currency: price.currency,
              },
            },
          },
          { type: "GetCart" },
        ],
      });
      notify(`Added ${quantity} × ${productName} to your cart`, "success");
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  }

  return { add, isPending: chain.isPending };
}
```

- [ ] **Step 2: Replace `src/catalog/ProductCard.tsx`**

```tsx
import { Link } from "react-router-dom";
import type { ProductCardVM, PriceVM } from "../lib/adapters";
import { money } from "@viu/emporix-examples-shared";

/**
 * One product in a grid. Image and name link to the product page; «Add to cart»
 * sits outside the links (a button inside a link is invalid HTML) and only
 * appears when the site's context resolves a price.
 */
export function ProductCard({
  vm,
  price,
  onAdd,
  adding = false,
}: {
  vm: ProductCardVM;
  price?: PriceVM | undefined;
  onAdd?: (() => void) | undefined;
  adding?: boolean;
}) {
  const href = `/product/${encodeURIComponent(vm.id)}`;
  return (
    <article className="pc">
      {/* The name below is the accessible link; this one is a larger click target. */}
      <Link to={href} className="pc__media" tabIndex={-1} aria-hidden="true">
        {vm.image ? <img src={vm.image} alt="" loading="lazy" /> : <span className="pc__ph">{initials(vm.name)}</span>}
      </Link>
      <div className="pc__meta">
        {vm.code !== vm.id ? <span className="pc__code">Art. {vm.code}</span> : null}
        <Link to={href} className="pc__name">
          {vm.name}
        </Link>
        {price ? (
          <span className="price pc__price">{money(price.amount, price.currency)}</span>
        ) : (
          <span className="pc__noprice">No price in this context</span>
        )}
        {price && onAdd ? (
          <button type="button" className="btn btn--accent btn--sm pc__add" onClick={onAdd} disabled={adding}>
            Add to cart
          </button>
        ) : null}
      </div>
    </article>
  );
}

/** Up to two initials for the placeholder of a product without an image. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}
```

- [ ] **Step 3: Replace `src/catalog/ProductGrid.tsx`**

```tsx
import type { Product } from "@viu/emporix-sdk";
import type { PriceVM } from "../lib/adapters";
import { toProductCard } from "../lib/adapters";
import { ProductCard } from "./ProductCard";
import { useAddToCart } from "./useAddToCart";

export function ProductGrid({
  products,
  priceOf,
}: {
  products: Product[];
  priceOf?: ((id: string) => PriceVM | undefined) | undefined;
}) {
  // One hook for the whole grid; see useAddToCart for why not one per card.
  const { add, isPending } = useAddToCart();
  const cards = products.map(toProductCard).map((vm) => ({ vm, price: priceOf?.(vm.id) }));
  // ponytail: priced products first within what is loaded — a priced product on
  // a page not loaded yet does not move up. Upgrade path: match prices over more
  // than one page before sorting.
  cards.sort((a, b) => Number(!a.price) - Number(!b.price));
  return (
    <div className="product-grid">
      {cards.map(({ vm, price }, i) => (
        <ProductCard
          key={vm.id || i}
          vm={vm}
          price={price}
          adding={isPending}
          {...(price ? { onAdd: () => void add(vm.id, vm.name, price, 1) } : {})}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Replace `src/catalog/CategoryNav.tsx` (chips) and create `src/catalog/CategorySidebar.tsx`**

```tsx
import { Link } from "react-router-dom";
import { useCategoryTree } from "@viu/emporix-sdk-react";
import { catId, catLabel } from "../lib/adapters";

/** Roots shown as chips before «All categories» takes over. */
const CHIPS = 6;

// Top-level navigation = the curated category-tree roots (not the flat
// `categories.list()` dump, which mixes in every leaf category).
export function CategoryNav() {
  const { data } = useCategoryTree();
  const cats = data ?? [];
  if (cats.length === 0) return null;
  return (
    <nav className="chips" aria-label="Categories">
      {cats.slice(0, CHIPS).map((c) => (
        <Link key={catId(c)} to={`/category/${encodeURIComponent(catId(c))}`} className="tag">
          {catLabel(c)}
        </Link>
      ))}
      {cats.length > CHIPS ? (
        <Link to="/categories" className="tag">
          All categories →
        </Link>
      ) : null}
    </nav>
  );
}
```

```tsx
import { useState } from "react";
import { Link } from "react-router-dom";
import type { CategoryNode } from "@viu/emporix-sdk";
import { useCategoryTree } from "@viu/emporix-sdk-react";
import { catLabel } from "../lib/adapters";

/** The category tree as nested links; the branch holding `activeId` is open. */
export function CategoryTree({ activeId }: { activeId?: string | undefined }) {
  const { data } = useCategoryTree();
  const roots = data ?? [];
  if (roots.length === 0) return null;
  return (
    <ul className="cat-tree">
      {roots.map((n) => (
        <Branch key={n.id} node={n} activeId={activeId} />
      ))}
    </ul>
  );
}

function contains(node: CategoryNode, id: string | undefined): boolean {
  if (!id) return false;
  return node.id === id || (node.subcategories ?? []).some((c) => contains(c, id));
}

function Branch({ node, activeId }: { node: CategoryNode; activeId?: string | undefined }) {
  const children = node.subcategories ?? [];
  return (
    <li>
      <Link
        to={`/category/${encodeURIComponent(node.id)}`}
        className="cat-tree__link"
        aria-current={node.id === activeId ? "page" : undefined}
      >
        {catLabel(node)}
      </Link>
      {children.length > 0 && contains(node, activeId) ? (
        <ul className="cat-tree">
          {children.map((c) => (
            <Branch key={c.id} node={c} activeId={activeId} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** Left column on category and search pages; behind a button below 48rem. */
export function CategorySidebar({ activeId }: { activeId?: string | undefined }) {
  const [open, setOpen] = useState(false);
  return (
    <aside className="sidebar" aria-label="Categories">
      <button
        type="button"
        className="btn btn--outline btn--sm sidebar__toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        Categories
      </button>
      <div className="sidebar__panel" data-open={open}>
        <p className="sidebar__title">Categories</p>
        <CategoryTree activeId={activeId} />
      </div>
    </aside>
  );
}
```

- [ ] **Step 5: Create `src/pages/Categories.tsx`, replace `src/pages/Home.tsx`, delete the hero**

```tsx
import { CategoryTree } from "../catalog/CategorySidebar";

export function Categories() {
  return (
    <div className="container page">
      <h1 className="page-title">All categories</h1>
      <CategoryTree />
    </div>
  );
}
```

```tsx
import type { Product } from "@viu/emporix-sdk";
import { useActiveSite, useProducts, useProductsInCategory } from "@viu/emporix-sdk-react";
import { CategoryNav } from "../catalog/CategoryNav";
import { ProductGrid } from "../catalog/ProductGrid";
import { usePrices } from "../lib/usePrices";
import { Loading } from "../components/ui/Spinner";
import { EmptyState } from "../components/ui/EmptyState";

export function Home({ tenant, featuredCategoryId }: { tenant: string; featuredCategoryId?: string | undefined }) {
  const site = useActiveSite();
  return (
    <div className="container home">
      <p className="muted home__intro">
        Live demo on tenant <strong>{tenant}</strong>
        {site ? (
          <>
            {" "}
            · site <strong>{site.name}</strong>
          </>
        ) : null}
        . Catalogue, cart, checkout and account all run against it.
      </p>
      <CategoryNav />
      {featuredCategoryId ? <FeaturedCategory id={featuredCategoryId} /> : <FeaturedFirst />}
    </div>
  );
}

// Two components because a hook cannot be skipped: each fetches exactly one list.
function FeaturedCategory({ id }: { id: string }) {
  const { data, isLoading, isError } = useProductsInCategory(id, { pageSize: 12 });
  return <Featured products={data?.items ?? []} isLoading={isLoading} isError={isError} />;
}

function FeaturedFirst() {
  const { data, isLoading, isError } = useProducts({ pageSize: 12 });
  return <Featured products={data?.items ?? []} isLoading={isLoading} isError={isError} />;
}

function Featured({ products, isLoading, isError }: { products: Product[]; isLoading: boolean; isError: boolean }) {
  const priceOf = usePrices(products);
  return (
    <section>
      <div className="section-head">
        <h2>Featured</h2>
      </div>
      {isLoading ? (
        <Loading label="Loading products" />
      ) : isError ? (
        <EmptyState title="Couldn't load products">Check the tenant and storefront client id (footer → Change setup).</EmptyState>
      ) : products.length === 0 ? (
        <EmptyState title="No products yet">This tenant or category has no published products.</EmptyState>
      ) : (
        <ProductGrid products={products} priceOf={priceOf} />
      )}
    </section>
  );
}
```

```bash
git rm examples/storefront-demo/src/catalog/Hero.tsx
```

- [ ] **Step 6: Category and search pages get the sidebar**

Replace the `return (…)` of `src/pages/Category.tsx` (lines 21–62) with the block below, and add `import { CategorySidebar } from "../catalog/CategorySidebar";` to its imports:

```tsx
  return (
    <div className="container with-sidebar">
      <CategorySidebar activeId={categoryId} />
      <section>
        <h1 className="page-title">{category ? catLabel(category) : "…"}</h1>
        {subcats.length > 0 ? (
          <nav className="chips" aria-label="Subcategories">
            {subcats.map((s) => (
              <Link key={catId(s)} to={`/category/${encodeURIComponent(catId(s))}`} className="tag">
                {catLabel(s)}
              </Link>
            ))}
          </nav>
        ) : null}

        {isLoading ? (
          <Loading />
        ) : isError ? (
          <EmptyState title="Couldn't load this category" />
        ) : products.length === 0 ? (
          // Pure parent category (only subcategories) → the chips above are enough.
          subcats.length > 0 ? null : <EmptyState title="No products in this category" />
        ) : (
          <>
            <ProductGrid products={products} priceOf={priceOf} />
            {hasNextPage ? (
              <div className="load-more">
                <Button variant="outline" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>
                  {isFetchingNextPage ? "Loading…" : "Load more"}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
```

Replace the `return (…)` of `src/pages/Search.tsx` (lines 16–32) with the block below, and add the same `CategorySidebar` import:

```tsx
  return (
    <div className="container with-sidebar">
      <CategorySidebar />
      <section>
        <h1 className="page-title">{q ? `Results for “${q}”` : "Search"}</h1>
        {!q ? (
          <EmptyState title="Search the catalogue">Type a query in the header.</EmptyState>
        ) : isLoading || isFetching ? (
          <Loading />
        ) : products.length === 0 ? (
          <EmptyState title="No matches">Nothing found for “{q}”.</EmptyState>
        ) : (
          <ProductGrid products={products} priceOf={priceOf} />
        )}
      </section>
    </div>
  );
```

- [ ] **Step 7: Product page — article number, price or «No price…», the new buy bar**

Replace the final `return (…)` of `src/pages/Product.tsx` (lines 39–67) with:

```tsx
  const code = (product as { code?: string }).code;

  return (
    <div className="container page">
      <p className="back-link">
        <Link to="/" className="u-underline">
          ← Catalogue
        </Link>
      </p>
      <div className="pdp__grid">
        <ProductGallery media={productImages(product)} alt={name} />
        <div className="pdp__info">
          {code && code !== id ? <p className="pc__code">Art. {code}</p> : null}
          <h1 className="pdp__title">{name}</h1>
          {price ? (
            <p className="price pdp__price">{money(price.amount, price.currency)}</p>
          ) : (
            <p className="pc__noprice">No price in this context</p>
          )}
          {desc ? (
            // Description may contain merchant HTML — render it (sanitized in
            // `productDescription`) rather than stripping the markup.
            <div className="pdp__desc" dangerouslySetInnerHTML={{ __html: desc }} />
          ) : null}
          <VariantPicker productId={id} />
          <AddToCartBar productId={id} productName={name} price={price} />
        </div>
      </div>
    </div>
  );
```

Replace `src/catalog/AddToCartBar.tsx`:

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PriceVM } from "../lib/adapters";
import { Button } from "../components/ui/Button";
import { useAddToCart } from "./useAddToCart";

export function AddToCartBar({
  productId,
  productName,
  price,
}: {
  productId: string;
  productName: string;
  price?: PriceVM | undefined;
}) {
  const { add, isPending } = useAddToCart();
  const nav = useNavigate();
  const [qty, setQty] = useState(1);
  // Emporix requires a priceId on internal-type cart items — only priced products
  // are purchasable. Say so instead of letting the API answer 400.
  const purchasable = Boolean(price?.priceId);

  return (
    <div className="buy-bar">
      <div className="cluster">
        <div className="qty" role="group" aria-label="Quantity">
          <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease">
            –
          </button>
          <span aria-live="polite">{qty}</span>
          <button type="button" onClick={() => setQty((q) => q + 1)} aria-label="Increase">
            +
          </button>
        </div>
        <Button
          variant="accent"
          onClick={() => {
            if (price) void add(productId, productName, price, qty);
          }}
          disabled={!purchasable || isPending}
        >
          {isPending ? "Adding…" : "Add to cart"}
        </Button>
        <Button variant="ghost" onClick={() => nav("/cart")}>
          View cart →
        </Button>
      </div>
      {!purchasable ? (
        <p className="muted buy-bar__hint">
          No price for this product on the selected site. Prices depend on the site chosen in the setup.
        </p>
      ) : null}
    </div>
  );
}
```

In `src/catalog/ProductGallery.tsx` replace line 13:

```tsx
        {hero ? <img src={hero} alt={alt} /> : <div className="pc__ph" style={{ aspectRatio: "1 / 1" }} />}
```

with:

```tsx
        {hero ? <img src={hero} alt={alt} /> : <span className="pc__ph" aria-hidden="true" />}
```

In `src/catalog/VariantPicker.tsx` replace `<div style={{ marginTop: "var(--s-5)" }}>` with `<div className="variants">` and `<div className="cluster" style={{ marginTop: "var(--s-2)" }}>` with `<div className="cluster variants__list">`.

- [ ] **Step 8: Routes in `src/App.tsx`**

Add `import { Categories } from "./pages/Categories";` and replace the two route lines

```tsx
                <Route path="/" element={<Home />} />
                <Route path="/search" element={<Search />} />
```

with:

```tsx
                <Route
                  path="/"
                  element={<Home tenant={config.tenant} featuredCategoryId={config.featuredCategoryId} />}
                />
                <Route path="/categories" element={<Categories />} />
                <Route path="/search" element={<Search />} />
```

- [ ] **Step 9: Replace `src/styles/catalog.css`**

```css
/* Catalogue: page frame, chips, sidebar and category tree, product grid and
   card, product page, quantity stepper. Task 6 appends the cart page. */

.page {
  padding-block: var(--s-5) var(--s-6);
}
.page-title {
  font-size: var(--step-3);
  margin-bottom: var(--s-4);
}
.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--s-4);
  margin-block: var(--s-5) var(--s-4);
}
.back-link {
  margin-bottom: var(--s-4);
  font-size: var(--step--1);
}
.load-more {
  display: flex;
  justify-content: center;
  margin-top: var(--s-6);
}

/* Home */
.home {
  padding-block: var(--s-5) var(--s-6);
}
.home__intro {
  margin-bottom: var(--s-4);
}

/* Chips row: categories and subcategories */
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-2);
  margin-bottom: var(--s-5);
}
.chips .tag:hover {
  border-color: var(--text);
}

/* Sidebar layout: category and search pages */
.with-sidebar {
  display: grid;
  gap: var(--s-5);
  padding-block: var(--s-5) var(--s-6);
}
.sidebar__panel {
  display: none;
}
.sidebar__panel[data-open="true"] {
  display: block;
}
.sidebar__title {
  font-size: var(--step--1);
  font-weight: 700;
  margin-bottom: var(--s-2);
}
@media (min-width: 48rem) {
  .with-sidebar {
    grid-template-columns: 15rem minmax(0, 1fr);
    align-items: start;
  }
  .sidebar {
    position: sticky;
    top: 7rem;
    max-height: calc(100vh - 8rem);
    overflow: auto;
  }
  .sidebar__toggle {
    display: none;
  }
  .sidebar__panel {
    display: block;
  }
}
.cat-tree {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 2px;
  font-size: var(--step--1);
}
.cat-tree .cat-tree {
  padding-left: var(--s-3);
  margin-top: 2px;
}
.cat-tree__link {
  display: block;
  padding: 0.3em 0.5em;
  border-radius: var(--radius);
  color: var(--text);
}
.cat-tree__link:hover {
  background: var(--surface);
}
.cat-tree__link[aria-current="page"] {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 700;
}

/* Product grid and card */
.product-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--s-4);
}
@media (min-width: 48rem) {
  .product-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (min-width: 68rem) {
  .product-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
.pc {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: var(--line-w) solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--bg);
}
.pc__media {
  display: block;
  aspect-ratio: 1 / 1;
  padding: var(--s-3);
  border-bottom: var(--line-w) solid var(--line);
  background: var(--bg);
}
.pc__media img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.pc__ph {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text-2);
  font-size: var(--step-2);
  font-weight: 700;
}
.pc__meta {
  display: flex;
  flex-direction: column;
  gap: var(--s-1);
  flex: 1;
  padding: var(--s-3);
}
.pc__code {
  font-size: var(--step--2);
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
.pc__name {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 2.7em;
  font-size: var(--step--1);
  font-weight: 600;
  line-height: 1.35;
}
.pc__name:hover {
  color: var(--accent);
}
.pc__price {
  font-size: var(--step-0);
}
.pc__noprice {
  font-size: var(--step--1);
  color: var(--text-2);
}
.pc__add {
  margin-top: auto;
}

/* Product page */
.pdp__grid {
  display: grid;
  gap: var(--s-6);
}
@media (min-width: 52rem) {
  .pdp__grid {
    grid-template-columns: 1.1fr 1fr;
    align-items: start;
  }
  .pdp__info {
    position: sticky;
    top: 7rem;
  }
}
.pdp__hero {
  aspect-ratio: 1 / 1;
  overflow: hidden;
  padding: var(--s-4);
  border: var(--line-w) solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--bg);
}
.pdp__hero img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.pdp__thumbs {
  display: flex;
  gap: var(--s-2);
  margin-top: var(--s-2);
}
.pdp__thumb {
  width: 4.5rem;
  aspect-ratio: 1 / 1;
  padding: var(--s-1);
  border: var(--line-w) solid var(--line);
  border-radius: var(--radius);
  background: var(--bg);
  cursor: pointer;
}
.pdp__thumb.is-active,
.pdp__thumb:hover {
  border-color: var(--accent);
}
.pdp__thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.pdp__title {
  font-size: var(--step-3);
  margin-block: var(--s-1) var(--s-3);
}
.pdp__price {
  font-size: var(--step-2);
}
.pdp__desc {
  max-width: 60ch;
  margin-top: var(--s-4);
  color: var(--text-2);
}
.pdp__desc > :first-child {
  margin-top: 0;
}
.pdp__desc > :last-child {
  margin-bottom: 0;
}
.pdp__desc p,
.pdp__desc ul,
.pdp__desc ol {
  margin-block: 0.6em;
}
.pdp__desc ul,
.pdp__desc ol {
  padding-inline-start: 1.4em;
}
.pdp__desc a {
  color: var(--accent);
  text-decoration: underline;
}
.pdp__desc h2,
.pdp__desc h3,
.pdp__desc h4 {
  margin-block: 0.8em 0.3em;
  color: var(--text);
  font-size: var(--step-1);
}
.pdp__desc img {
  max-width: 100%;
  height: auto;
  border-radius: var(--radius);
}
.variants {
  margin-top: var(--s-5);
}
.variants__list {
  margin-top: var(--s-2);
}
.buy-bar {
  margin-top: var(--s-5);
}
.buy-bar__hint {
  margin-top: var(--s-3);
  font-size: var(--step--1);
}

/* Quantity stepper */
.qty {
  display: inline-flex;
  align-items: center;
  border: var(--line-w) solid var(--control);
  border-radius: var(--radius);
}
.qty button {
  width: 2.4rem;
  height: 2.4rem;
  border: 0;
  background: transparent;
  font-size: var(--step-1);
  line-height: 1;
  cursor: pointer;
}
.qty button:hover {
  color: var(--accent);
}
.qty span {
  min-width: 2.2rem;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
```

The old `.cart*` rules are gone from this file until Task 6 appends the new ones; `Cart.tsx` and the PR 1 `Checkout.tsx` render unstyled lists in between, which Task 6 fixes before PR 1 opens.

- [ ] **Step 10: Gate — no inline style in the files this task rewrote**

```bash
grep -n "style={" examples/storefront-demo/src/catalog/*.tsx examples/storefront-demo/src/pages/{Home,Category,Search,Product,Categories}.tsx || echo "ok: catalogue has no inline styles"
```

Expected: `ok: catalogue has no inline styles`.

- [ ] **Step 11: Typecheck, build, commit**

```bash
pnpm -F @viu/emporix-examples-storefront-demo typecheck
pnpm -F @viu/emporix-examples-storefront-demo build
git add -A examples/storefront-demo/src
git commit -m "feat(examples): show prices first and add to cart from the grid" \
  -m "Cards show the article number and either the price with «Add to cart» or
«No price in this context». Grids put priced products first, the home page
fills from the featured category, category and search pages get a
category-tree sidebar, and «All categories» lists every root." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Cart page and product details

**Files:**
- Modify: `src/lib/useProductNames.ts`, `src/pages/Cart.tsx`, `src/styles/catalog.css` (append)

**Interfaces:**
- Consumes: `toProductCard` from `../lib/adapters`.
- Produces:
  - `interface ProductDetails { name: string; image?: string; code?: string }`
  - `useProductDetails(productIds: string[]): Record<string, ProductDetails>`
  - `useProductNames(productIds: string[]): Record<string, string>` (unchanged signature; `ShoppingListPanel` keeps using it)
  - Classes `.cart`, `.cart__lines`, `.cart__line`, `.cart__thumb`, `.cart__name`, `.cart__actions`, `.cart__line-total`, `.cart__summary`, `.cart__total`, `.cart__grand`, `.coupon-form`, `.cart__coupons`, `.cart__checkout`.

- [ ] **Step 1: Replace `src/lib/useProductNames.ts`**

```ts
import { useQuery } from "@tanstack/react-query";
import { useEmporix } from "@viu/emporix-sdk-react";
import { toProductCard } from "./adapters";

export interface ProductDetails {
  name: string;
  image?: string;
  /** The article number, when the product has one besides its id. */
  code?: string;
}

/**
 * Resolves name, image and article number by product id. Cart items carry only
 * an `itemYrn` (the cart GET returns an empty `product`), so cart and checkout
 * lines look them up here, in one `searchByIds` call.
 */
export function useProductDetails(productIds: string[]): Record<string, ProductDetails> {
  const { client } = useEmporix();
  const ids = Array.from(new Set(productIds.filter(Boolean))).sort();
  const { data } = useQuery({
    queryKey: ["demo", "product-details", client.tenant, ids],
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const products = await client.products.searchByIds(ids);
      const map: Record<string, ProductDetails> = {};
      for (const p of products) {
        const vm = toProductCard(p);
        if (!vm.id) continue;
        map[vm.id] = {
          name: vm.name,
          ...(vm.image ? { image: vm.image } : {}),
          ...(vm.code !== vm.id ? { code: vm.code } : {}),
        };
      }
      return map;
    },
  });
  return data ?? {};
}

/** Display names only, for the callers that need nothing else. */
export function useProductNames(productIds: string[]): Record<string, string> {
  const details = useProductDetails(productIds);
  return Object.fromEntries(Object.entries(details).map(([id, d]) => [id, d.name]));
}
```

- [ ] **Step 2: `src/pages/Cart.tsx` — classes, «cart» wording, images and article numbers**

Change the import line `import { useProductNames } from "../lib/useProductNames";` to:

```tsx
import { useProductDetails } from "../lib/useProductNames";
```

and `const names = useProductNames(lines.map((l) => l.productId));` to:

```tsx
  const details = useProductDetails(lines.map((l) => l.productId));
```

Replace the loading and empty returns' wording: `<Loading label="Loading your bag" />` → `<Loading label="Loading your cart" />`; `<EmptyState title="Your bag is empty">` → `<EmptyState title="Your cart is empty">`.

Replace the final `return (…)` (from `<div className="container" style={{ paddingBlock: "var(--s-6)" }}>` to the end of the component) with:

```tsx
  return (
    <div className="container page">
      <h1 className="page-title">Your cart</h1>
      <div className="cart">
        <ul className="cart__lines">
          {lines.map((l) => {
            const d = details[l.productId];
            const image = d?.image ?? l.image;
            return (
              <li key={l.id} className="cart__line">
                <div className="cart__thumb">{image ? <img src={image} alt="" /> : <span className="pc__ph" />}</div>
                <div>
                  {d?.code ? <span className="pc__code">Art. {d.code}</span> : null}
                  <p className="cart__name">{d?.name ?? (l.name || l.productId)}</p>
                  <div className="cluster cart__actions">
                    <div className="qty" role="group" aria-label="Quantity">
                      <button type="button" onClick={() => void setQty(l, l.quantity - 1)} aria-label="Decrease">
                        –
                      </button>
                      <span>{l.quantity}</span>
                      <button type="button" onClick={() => void setQty(l, l.quantity + 1)} aria-label="Increase">
                        +
                      </button>
                    </div>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => void remove(l)}>
                      Remove
                    </button>
                  </div>
                </div>
                <div className="price cart__line-total">
                  {l.lineTotal ? money(l.lineTotal.amount, l.lineTotal.currency) : ""}
                </div>
              </li>
            );
          })}
        </ul>

        <aside className="cart__summary surface">
          <h2>Summary</h2>
          <form onSubmit={applyCoupon} className="coupon-form">
            <label className="field__label" htmlFor="coupon">
              Coupon
            </label>
            <div className="cluster">
              <input
                id="coupon"
                className="input"
                value={coupon}
                onChange={(e) => setCoupon(e.target.value)}
                placeholder="Code"
              />
              <Button type="submit" variant="outline" size="sm" disabled={chain.isPending}>
                Apply
              </Button>
            </div>
          </form>
          {coupons.length > 0 ? (
            <div className="cluster cart__coupons">
              {coupons.map((c) => (
                <button key={c} type="button" className="tag tag--accent" onClick={() => void removeCoupon(c)}>
                  {c} ✕
                </button>
              ))}
            </div>
          ) : null}

          <hr className="rule" />
          <div className="cart__total">
            <span>Total</span>
            <span className="price cart__grand">{total ? money(total.amount, total.currency) : "—"}</span>
          </div>
          <p className="field__hint">Delivery is chosen in the checkout.</p>
          <Button variant="accent" block onClick={() => nav("/checkout")} className="cart__checkout">
            Checkout →
          </Button>
        </aside>
      </div>
    </div>
  );
```

- [ ] **Step 3: Append the cart styles to `src/styles/catalog.css`**

The PR 1 checkout still uses `.cart`, `.cart__summary` and `.cart__total`, so these rules serve it too until Task 15.

```css
/* Cart page */
.cart {
  display: grid;
  gap: var(--s-6);
}
@media (min-width: 52rem) {
  .cart {
    grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
    align-items: start;
  }
}
.cart__lines {
  list-style: none;
  margin: 0;
  padding: 0;
}
.cart__line {
  display: grid;
  grid-template-columns: 4.5rem minmax(0, 1fr) auto;
  gap: var(--s-4);
  align-items: center;
  padding-block: var(--s-4);
  border-bottom: var(--line-w) solid var(--line);
}
.cart__line:first-child {
  border-top: var(--line-w) solid var(--line);
}
.cart__thumb {
  width: 4.5rem;
  aspect-ratio: 1 / 1;
  padding: var(--s-1);
  border: var(--line-w) solid var(--line);
  border-radius: var(--radius);
  background: var(--bg);
}
.cart__thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.cart__name {
  font-weight: 600;
}
.cart__actions {
  margin-top: var(--s-2);
  gap: var(--s-4);
}
.cart__line-total {
  font-size: var(--step-1);
}
.cart__summary {
  padding: var(--s-5);
  background: var(--surface);
}
.cart__summary h2 {
  font-size: var(--step-1);
}
.cart__summary .rule {
  margin-block: var(--s-5) var(--s-3);
}
@media (min-width: 52rem) {
  .cart__summary {
    position: sticky;
    top: 7rem;
  }
}
.cart__total {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--s-4);
}
.cart__grand {
  font-size: var(--step-2);
}
.coupon-form {
  margin-top: var(--s-4);
}
.coupon-form .cluster {
  margin-top: var(--s-2);
  gap: var(--s-2);
}
.coupon-form .input {
  flex: 1;
}
.cart__coupons {
  margin-top: var(--s-3);
}
.cart__checkout {
  margin-top: var(--s-4);
}
```

- [ ] **Step 4: Gate, typecheck, build, commit**

```bash
grep -n "style={" examples/storefront-demo/src/pages/Cart.tsx || echo "ok: cart has no inline styles"
pnpm -F @viu/emporix-examples-storefront-demo typecheck
pnpm -F @viu/emporix-examples-storefront-demo build
git add examples/storefront-demo/src
git commit -m "feat(examples): restyle the storefront demo cart" \
  -m "Lines show the product image and article number through a details lookup
that replaces the names-only one (the cart GET returns an empty product). The
page says «cart» throughout." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: `ok: cart has no inline styles`; typecheck and build exit 0.

---

### Task 7: Live check of PR 1 (with the user)

No code. Produces the screenshots for the PR body and the answer to open question 3 of the spec.

- [ ] **Step 1: Start the dev server in the browser pane**

Use the preview tool with the `storefront-demo` entry of `.claude/launch.json` (port 5175). Then clear any earlier demo state so the new setup runs: run `localStorage.removeItem("emporix.demo.config")` in the page and reload.

- [ ] **Step 2: Hand step 1 of the setup to the user**

Ask the user to enter the tenant and the storefront client id and press «Connect». The agent does not type the client id.

- [ ] **Step 3: Check the setup's second step**

Expected: one `RadioCard` per active site with code, currency and ship-to countries; the default site preselected; the featured-category select lists the category roots. Pick, together with the user, the B2B site and a category whose products have prices there; «Enter the store».

- [ ] **Step 4: Walk the catalogue at desktop width, then at 375px (`resize_window` preset `mobile`)**

Check each and take a screenshot:
1. Home: intro line names tenant and site; chips plus «All categories →»; «Featured» shows cards with images, article numbers, prices and «Add to cart».
2. A category page: sidebar with the active branch open (desktop), «Categories» button (mobile); priced products first.
3. A product page: article number, price, quantity, «Add to cart»; a product without a price shows «No price in this context» and the disabled button with the hint.
4. Add one product from a card and one from the product page; the cart count in the header rises; the cart page shows images and article numbers.
5. Console: `read_console_messages` with `onlyErrors: true` returns nothing new.

Reset the viewport with preset `desktop` afterwards.

- [ ] **Step 5: Runtime site switch (spec, open question 3)**

1. In a fresh guest state (no cart: run `localStorage.removeItem("emporix.cartId")` and reload), switch the header's site select from the B2B site to the default site, open the featured category, and note whether the prices change (the B2B prices disappear or differ).
2. Record the outcome. If guest prices **change**, skip Task 8 and say so in the PR body. If they **do not change**, do Task 8.

---

### Task 8: Rebuild the client on a site switch — only if Task 7 Step 5 found guest prices unchanged

**Files:**
- Modify: `src/config/ConfigGate.tsx`, `src/App.tsx`, `src/app/AppShell.tsx`, `src/app/Header.tsx`, `src/app/SiteCurrencySwitcher.tsx`

**Interfaces:**
- Consumes: `siteContext(site)` (Task 4), `save` from `useDemoConfig`.
- Produces: `SiteCurrencySwitcher({ onSiteChange?: ((site: Site) => void) | undefined })`, `Header({ onSiteChange? })`, `AppShell({ …, onSiteChange? })`; `ConfigGate`'s render function gains a fourth argument `save`.

- [ ] **Step 1: `ConfigGate` passes `save` through**

Replace `src/config/ConfigGate.tsx` with:

```tsx
import type { ReactNode } from "react";
import { useDemoConfig, type DemoConfig } from "./useDemoConfig";
import { SetupScreen } from "./SetupScreen";

export function ConfigGate({
  children,
}: {
  children: (
    config: DemoConfig,
    reset: () => void,
    persist: (partial: Partial<DemoConfig>) => void,
    save: (config: DemoConfig) => void,
  ) => ReactNode;
}) {
  const { config, save, reset, persist } = useDemoConfig();
  if (!config) return <SetupScreen onSubmit={save} />;
  return <>{children(config, reset, persist, save)}</>;
}
```

- [ ] **Step 2: The switcher reports a site change instead of calling `setSite`**

In `src/app/SiteCurrencySwitcher.tsx`, add `import type { Site } from "@viu/emporix-sdk";`, change the signature to

```tsx
export function SiteCurrencySwitcher({ onSiteChange }: { onSiteChange?: ((site: Site) => void) | undefined }) {
```

and the site select's `onChange` to:

```tsx
          onChange={(e) => {
            const next = sites!.find((s) => s.code === e.target.value);
            // setSite only PATCHes the session context, which does not re-price a
            // guest without a cart; the demo rebuilds the client instead.
            if (next && onSiteChange) onSiteChange(next);
            else void setSite(e.target.value || null);
          }}
```

In `src/app/Header.tsx` change the signature to `export function Header({ onSiteChange }: { onSiteChange?: ((site: Site) => void) | undefined })`, add `import type { Site } from "@viu/emporix-sdk";` and render `<SiteCurrencySwitcher onSiteChange={onSiteChange} />`.

In `src/app/AppShell.tsx` add `onSiteChange?: ((site: Site) => void) | undefined` to the props (destructure it, import the type) and render `<Header onSiteChange={onSiteChange} />`.

- [ ] **Step 3: `App.tsx` rebuilds on a site change**

In `src/App.tsx`:
- add `import type { Site } from "@viu/emporix-sdk";` and `import { siteContext } from "./config/connect";`;
- give `DemoApp` a `save: (c: DemoConfig) => void` prop and pass it from `App`: `{(config, reset, persist, save) => (<DemoApp config={config} reset={reset} save={save} persistCurrency={(c) => persist({ currency: c })} />)}`;
- key the provider so its site state starts fresh with the new client: `<EmporixProvider key={config.siteCode ?? "default"} client={client} …>`;
- inside `DemoApp`, before `return`, add:

```tsx
  function switchSite(site: Site) {
    // Carts are bound to site and currency; a new client with a new price context
    // must not adopt the old cart.
    storage.setCartId(null);
    save({ ...config, ...siteContext(site) });
  }
```

- pass it down: `<AppShell tenant={config.tenant} onReset={reset} onSiteChange={switchSite}>`.

- [ ] **Step 4: Typecheck, build, re-run Task 7 Step 5, commit**

```bash
pnpm -F @viu/emporix-examples-storefront-demo typecheck
pnpm -F @viu/emporix-examples-storefront-demo build
```

Repeat Task 7 Step 5. Expected: the prices now follow the site. Then:

```bash
git add examples/storefront-demo/src
git commit -m "fix(examples): rebuild the client when the demo switches site" \
  -m "setSite PATCHes the session context, which does not re-price a guest who
has no cart yet. Rebuilding the client binds the new site's currency and
country at anonymous login, as the setup does." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Note the SDK finding for the user: `setSite` in `packages/react/src/site-context.tsx` does not call `client.setStorefrontContext` the way `setCurrency` does. That fix belongs in its own SDK PR, not here.

---

### Task 9: README and PR 1

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update `README.md`**

Replace the block that starts `Vite prints a local URL (e.g. \`http://localhost:5173\`). On first load you get a` and ends with `` `VITE_DEMO_DEFAULT_TENANT` and `VITE_DEMO_DEFAULT_STOREFRONT_CLIENT_ID`. `` (the setup table and the paragraph under it) with:

```markdown
Vite prints a local URL (e.g. `http://localhost:5173`). On first load the setup
screen asks for two things, in two steps:

1. **Connect** — the **tenant** (lowercase, 3–16 chars, `a–z`, `0–9`) and its
   **public storefront client id** (no secret). The API host sits under
   «Advanced» and defaults to `https://api.emporix.io`. «Connect» signs in
   anonymously right away, so a wrong tenant or client id fails here.
2. **Choose a site** — the tenant's active sites, with currency and ship-to
   countries. The site sets the price context: its currency and its home country
   become the session's `currency` and `targetLocation`, which is what makes
   prices resolve. Optionally pick a **featured category** to fill the home page;
   choose one whose products have a price on that site.

Config is kept in `localStorage` (`emporix.demo.config`); **Change setup** in the
footer starts over. `VITE_DEMO_DEFAULT_TENANT` and
`VITE_DEMO_DEFAULT_STOREFRONT_CLIENT_ID` prefill step 1.
```

In «Flow checklist» replace the **Catalog** and **Product detail** bullets with:

```markdown
- **Catalog** — home with a featured category and category chips, a
  category-tree sidebar on category and search pages, and grids that put priced
  products first and add to the cart from the card (`useProductsInCategory`,
  `useCategoryTree`, `useMatchPrices`, `useCartCommands`).
- **Product detail** — gallery, article number, variant picker, add-to-cart with
  the price row Emporix requires; without a price in the site's context the
  button is disabled and says why (`useProduct`, `useVariantChildren`,
  `useCartCommands`).
```

In «Things worth knowing» replace the bullet that starts `- **Prices need currency + country.**` with:

```markdown
- **Prices depend on the site.** The price match resolves against the session's
  currency and country, which the setup derives from the chosen site. A product
  without a price in that context shows «No price in this context» and cannot be
  added to the cart.
```

In «Layout» replace the lines for `config/`, `components/` and `styles/` with:

```
  config/      the two-step setup (SetupScreen, connect.ts) and its gate (ConfigGate)
  components/  ui/ primitives — Button, Field, Tag, Spinner, EmptyState, Alert, RadioCard
  styles/      design tokens, base, shell and catalogue stylesheets
```

- [ ] **Step 2: Full verification**

```bash
pnpm build && pnpm typecheck && pnpm lint
pnpm -F @viu/emporix-examples-storefront-demo build
grep -rnE -- "--(paper|ink|oxblood|muted|good|line-2)\b" examples/storefront-demo/src || echo "ok: no old colour tokens"
git status --porcelain
```

Expected: everything exits 0; `ok: no old colour tokens`; `git status` lists only the README (and the untracked `.claude/launch.json`, which stays out).

- [ ] **Step 3: Commit, push, open PR 1**

```bash
git add examples/storefront-demo/README.md
git commit -m "docs(examples): describe the redesigned storefront demo" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u https://github.com/viuteam/emporix-sdk.git feat/storefront-demo-redesign
git fetch https://github.com/viuteam/emporix-sdk.git feat/storefront-demo-redesign:refs/remotes/origin/feat/storefront-demo-redesign
git branch --set-upstream-to=origin/feat/storefront-demo-redesign
gh pr create --base main --head feat/storefront-demo-redesign --label no-release \
  --title "feat(examples): redesign the storefront demo — design system, setup and catalogue" \
  --body-file <body.md>
```

The PR body (write it to a scratch file first) states: what changed and why (link the spec); the contrast output of Task 1 Step 6; the grep gates; the Task 7 screenshots; the site-switch outcome (and Task 8 if it ran, with the SDK finding); that merging deploys GitHub Pages and the public demo shows the old checkout flow in the new look until PR 2; that nothing in `packages/*` changed; and ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. After creating it, bind it with the session's PR tools and read its CI once; do not poll.

---

# PR 2 — Accordion checkout

Branch: create `feat/storefront-demo-checkout` from `feat/storefront-demo-redesign` and open PR 2 against `feat/storefront-demo-redesign` (retarget to `main` once PR 1 is merged).

```bash
git switch -c feat/storefront-demo-checkout feat/storefront-demo-redesign
```

### Task 10: Checkout totals

**Files:**
- Create: `src/checkout/totals.ts`

**Interfaces:**
- Produces:
  - `interface DeliveryChoice { methodId: string; zoneId: string; methodName: string; amount: number; shippingTaxCode?: string; freeFrom?: number }`
  - `interface CheckoutTotals { currency: string; subtotal: number; discount: number; delivery: number; total: number; tax?: number; freeDeliveryGap?: number }`
  - `checkoutTotals(cart: unknown, delivery: DeliveryChoice | null): CheckoutTotals | undefined`
  - `freeFrom(fees: ShippingMethod["fees"]): number | undefined`

- [ ] **Step 1: Create `src/checkout/totals.ts`**

```ts
import type { ShippingMethod } from "@viu/emporix-sdk";

/** The delivery option the shopper picked, shaped for the checkout `shipping` payload. */
export interface DeliveryChoice {
  methodId: string;
  zoneId: string;
  methodName: string;
  amount: number;
  shippingTaxCode?: string;
  /** Lowest order value at which this method costs nothing, when its fee table has such a tier. */
  freeFrom?: number;
}

export interface CheckoutTotals {
  currency: string;
  /** Items before discounts, gross. */
  subtotal: number;
  /** Discounts as the cart reports them. */
  discount: number;
  delivery: number;
  /** What the shopper pays: the cart's final price plus the delivery fee. Also the payment amount. */
  total: number;
  /** Tax inside the cart's final price. Items only: the cart does not know the delivery. */
  tax?: number;
  /** How much more the items must cost before this delivery method is free. */
  freeDeliveryGap?: number;
}

type ReadCart = {
  currency?: string;
  totalPrice?: { amount?: number; currency?: string };
  calculatedPrice?: {
    price?: { grossValue?: number };
    totalDiscount?: { value?: number };
    finalPrice?: { grossValue?: number; taxValue?: number };
  };
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * The checkout's money, in one place. Reads the cart's `calculatedPrice` and falls
 * back to the deprecated `totalPrice` on carts without it. Delivery is added here
 * because the cart does not know which method the shopper picked — and `total`,
 * delivery included, is what goes out as the payment amount.
 */
export function checkoutTotals(cart: unknown, delivery: DeliveryChoice | null): CheckoutTotals | undefined {
  const c = cart as ReadCart | null | undefined;
  const currency = c?.totalPrice?.currency ?? c?.currency;
  const items = c?.calculatedPrice?.finalPrice?.grossValue ?? c?.totalPrice?.amount;
  if (!currency || items === undefined) return undefined;
  const fee = delivery?.amount ?? 0;
  const out: CheckoutTotals = {
    currency,
    subtotal: c?.calculatedPrice?.price?.grossValue ?? items,
    discount: c?.calculatedPrice?.totalDiscount?.value ?? 0,
    delivery: fee,
    total: round2(items + fee),
  };
  const tax = c?.calculatedPrice?.finalPrice?.taxValue;
  if (tax !== undefined) out.tax = tax;
  if (delivery?.freeFrom !== undefined && fee > 0 && items < delivery.freeFrom) {
    out.freeDeliveryGap = round2(delivery.freeFrom - items);
  }
  return out;
}

/** Lowest order value at which a fee table charges nothing, if it has such a tier. */
export function freeFrom(fees: ShippingMethod["fees"]): number | undefined {
  const thresholds = (fees ?? []).flatMap((f) => {
    const min = f.minOrderValue?.amount ?? 0;
    return f.cost.amount === 0 && min > 0 ? [min] : [];
  });
  return thresholds.length > 0 ? Math.min(...thresholds) : undefined;
}
```

- [ ] **Step 2: Typecheck, then a throwaway check of the arithmetic**

```bash
pnpm -F @viu/emporix-examples-storefront-demo typecheck
```

Expected: exit 0. Then check the three numbers the live test will see, without committing anything:

```bash
node --experimental-strip-types --input-type=module -e '
const { checkoutTotals, freeFrom } = await import("./examples/storefront-demo/src/checkout/totals.ts");
const cart = { currency: "CHF", calculatedPrice: { price: { grossValue: 108.25 }, finalPrice: { grossValue: 108.25, taxValue: 8.12 } } };
const fees = [{ minOrderValue: { amount: 0 }, cost: { amount: 12.9 } }, { minOrderValue: { amount: 150 }, cost: { amount: 0 } }];
const d = { methodId: "standard", zoneId: "ch", methodName: "Standard", amount: 12.9, freeFrom: freeFrom(fees) };
const t = checkoutTotals(cart, d);
console.log(JSON.stringify(t));
if (t.total !== 121.15 || t.freeDeliveryGap !== 41.75 || freeFrom(fees) !== 150) process.exit(1);
console.log(JSON.stringify(checkoutTotals({ totalPrice: { amount: 10, currency: "CHF" } }, null)));'
```

Expected: `{"currency":"CHF","subtotal":108.25,"discount":0,"delivery":12.9,"total":121.15,"tax":8.12,"freeDeliveryGap":41.75}` then `{"currency":"CHF","subtotal":10,"discount":0,"delivery":0,"total":10}`; exit 0. (`totals.ts` imports only a type, so Node's type stripping runs it as is.)

- [ ] **Step 3: Commit**

```bash
git add examples/storefront-demo/src/checkout/totals.ts
git commit -m "feat(examples): compute checkout totals including delivery" \
  -m "One function reads calculatedPrice (falling back to the deprecated
totalPrice), adds the chosen delivery fee and reports how far the cart is from
free delivery. Its total becomes the payment amount." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Accordion shell, order summary, checkout styles

**Files:**
- Create: `src/checkout/CheckoutStep.tsx`, `src/checkout/OrderSummary.tsx`, `src/styles/checkout.css`
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: `CheckoutTotals` (Task 10), `ProductDetails` (Task 6), `CartLineVM` from `../lib/adapters`.
- Produces:
  - `type StepState = "open" | "done" | "todo"`
  - `CheckoutStep({ index: number; title: string; state: StepState; summary?: ReactNode; onEdit?: (() => void) | undefined; children?: ReactNode })`
  - `OrderSummary({ lines: CartLineVM[]; details: Record<string, ProductDetails>; totals: CheckoutTotals | undefined; deliveryName?: string | undefined })`
  - Classes `.checkout`, `.checkout__head`, `.co-layout`, `.co-steps`, `.co-step*`, `.co-actions`, `.form-grid*`, `.co-check`, `.co-card`, `.co-review*`, `.co-summary*`, `.co-lines`, `.co-line*`, `.co-totals*`, `.confirmation*`.

- [ ] **Step 1: Create `src/checkout/CheckoutStep.tsx`**

```tsx
import type { ReactNode } from "react";

export type StepState = "open" | "done" | "todo";

/**
 * One section of the checkout accordion. Open: the full content. Done: a
 * one-line summary with «Edit». To do: the title only.
 */
export function CheckoutStep({
  index,
  title,
  state,
  summary,
  onEdit,
  children,
}: {
  index: number;
  title: string;
  state: StepState;
  summary?: ReactNode;
  onEdit?: (() => void) | undefined;
  children?: ReactNode;
}) {
  return (
    <section className={`co-step co-step--${state}`} aria-label={title}>
      <div className="co-step__head">
        <span className="co-step__num" aria-hidden="true">
          {state === "done" ? "✓" : index}
        </span>
        <div>
          <h2 className="co-step__title">{title}</h2>
          {state === "done" && summary ? <p className="co-step__summary">{summary}</p> : null}
        </div>
        {state === "done" && onEdit ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={onEdit} aria-label={`Edit ${title}`}>
            Edit
          </button>
        ) : null}
      </div>
      {state === "open" ? <div className="co-step__body">{children}</div> : null}
    </section>
  );
}
```

- [ ] **Step 2: Create `src/checkout/OrderSummary.tsx`**

```tsx
import { useState } from "react";
import { money } from "@viu/emporix-examples-shared";
import type { CartLineVM } from "../lib/adapters";
import type { ProductDetails } from "../lib/useProductNames";
import type { CheckoutTotals } from "./totals";

/**
 * Lines and totals next to the steps; on narrow screens a bar above them that
 * shows the total and opens the details.
 */
export function OrderSummary({
  lines,
  details,
  totals,
  deliveryName,
}: {
  lines: CartLineVM[];
  details: Record<string, ProductDetails>;
  totals: CheckoutTotals | undefined;
  deliveryName?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  return (
    <aside className="co-summary" aria-label="Order summary">
      <button type="button" className="co-summary__bar" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>{open ? "Hide" : "Show"} order summary</span>
        <span className="price">{totals ? money(totals.total, totals.currency) : "—"}</span>
      </button>
      <div className="co-summary__body" data-open={open}>
        <h2 className="co-summary__title">Order summary</h2>
        <ul className="co-lines">
          {lines.map((l) => {
            const d = details[l.productId];
            return (
              <li key={l.id} className="co-line">
                <span className="co-line__img">{d?.image ? <img src={d.image} alt="" /> : null}</span>
                <span>
                  <span className="co-line__name">{d?.name ?? (l.name || l.productId)}</span>
                  <span className="co-line__meta">
                    {d?.code ? `Art. ${d.code} · ` : ""}
                    {l.quantity} × {l.unit ? money(l.unit.amount, l.unit.currency) : "—"}
                  </span>
                </span>
                <span className="price co-line__total">
                  {l.lineTotal ? money(l.lineTotal.amount, l.lineTotal.currency) : ""}
                </span>
              </li>
            );
          })}
        </ul>
        {totals ? (
          <div className="co-totals">
            <div className="co-totals__row">
              <span>Subtotal</span>
              <span>{money(totals.subtotal, totals.currency)}</span>
            </div>
            {totals.discount > 0 ? (
              <div className="co-totals__row">
                <span>Discount</span>
                <span>−{money(totals.discount, totals.currency)}</span>
              </div>
            ) : null}
            <div className="co-totals__row">
              <span>Delivery{deliveryName ? ` · ${deliveryName}` : ""}</span>
              <span>
                {deliveryName ? (totals.delivery === 0 ? "Free" : money(totals.delivery, totals.currency)) : "Chosen in step 3"}
              </span>
            </div>
            {totals.freeDeliveryGap !== undefined ? (
              <p className="co-totals__hint">Add {money(totals.freeDeliveryGap, totals.currency)} for free delivery</p>
            ) : null}
            <div className="co-totals__row co-totals__grand">
              <span>Total</span>
              <span>{money(totals.total, totals.currency)}</span>
            </div>
            {totals.tax !== undefined ? (
              <div className="co-totals__row muted">
                <span>incl. VAT on items</span>
                <span>{money(totals.tax, totals.currency)}</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: Create `src/styles/checkout.css` and import it**

```css
/* Checkout: accordion steps, step forms, review, order summary, confirmation. */

.checkout {
  padding-block: var(--s-5) var(--s-6);
}
.checkout__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--s-3);
}
.co-layout {
  display: grid;
  gap: var(--s-5);
}
@media (min-width: 60rem) {
  .co-layout {
    grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
    align-items: start;
  }
  .co-layout > .co-summary {
    order: 2;
  }
}
@media (max-width: 59.99rem) {
  .co-layout > .co-summary {
    order: -1;
  }
}
.co-steps {
  display: grid;
  gap: var(--s-3);
}
.co-step {
  padding: var(--s-3) var(--s-4);
  border: var(--line-w) solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--bg);
}
.co-step--open {
  padding: calc(var(--s-3) - 1px) calc(var(--s-4) - 1px);
  border: 2px solid var(--accent);
}
.co-step__head {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: var(--s-3);
  align-items: center;
}
.co-step__num {
  display: grid;
  place-items: center;
  width: 1.6rem;
  height: 1.6rem;
  border-radius: 999px;
  background: var(--line);
  color: var(--text-2);
  font-size: var(--step--1);
  font-weight: 700;
}
.co-step--open .co-step__num {
  background: var(--accent);
  color: #ffffff;
}
.co-step--done .co-step__num {
  background: var(--success);
  color: #ffffff;
}
.co-step__title {
  font-size: var(--step-0);
}
.co-step--todo .co-step__title {
  color: var(--text-2);
}
.co-step__summary {
  font-size: var(--step--1);
  color: var(--text-2);
  overflow-wrap: anywhere;
}
.co-step__body {
  margin-top: var(--s-4);
}
.co-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-3);
  margin-top: var(--s-4);
}

/* Step forms */
.form-grid {
  display: grid;
  gap: var(--s-3);
}
.form-grid--2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.form-grid--street {
  grid-template-columns: minmax(0, 3fr) minmax(0, 1fr);
}
.form-grid--city {
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
}
@media (max-width: 30rem) {
  .form-grid--2,
  .form-grid--city {
    grid-template-columns: minmax(0, 1fr);
  }
}
.co-check {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  margin-top: var(--s-3);
}
.co-check input {
  width: 1.1em;
  height: 1.1em;
  accent-color: var(--accent);
}
.co-card {
  display: grid;
  gap: 2px;
  padding: var(--s-3) var(--s-4);
  border: var(--line-w) solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}

/* Review */
.co-review {
  display: grid;
  gap: var(--s-3);
}
.co-review__block {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--s-1) var(--s-3);
  padding-bottom: var(--s-3);
  border-bottom: var(--line-w) solid var(--line);
}
.co-review__label {
  font-size: var(--step--1);
  font-weight: 700;
}
.co-review__value {
  grid-column: 1;
  font-size: var(--step--1);
  color: var(--text-2);
  overflow-wrap: anywhere;
}
.co-review__block .btn {
  grid-column: 2;
  grid-row: 1 / span 2;
  align-self: center;
}

/* Order summary */
.co-summary {
  border: var(--line-w) solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--surface);
}
.co-summary__bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--s-3);
  width: 100%;
  padding: var(--s-3) var(--s-4);
  border: 0;
  background: none;
  color: var(--accent);
  font-weight: 600;
  cursor: pointer;
}
.co-summary__body {
  display: none;
  padding: 0 var(--s-4) var(--s-4);
}
.co-summary__body[data-open="true"] {
  display: block;
}
@media (min-width: 60rem) {
  .co-summary {
    position: sticky;
    top: 7rem;
  }
  .co-summary__bar {
    display: none;
  }
  .co-summary__body {
    display: block;
    padding-top: var(--s-4);
  }
}
.co-summary__title {
  font-size: var(--step-1);
  margin-bottom: var(--s-3);
}
.co-lines {
  list-style: none;
  padding: 0;
  display: grid;
  gap: var(--s-3);
}
.co-line {
  display: grid;
  grid-template-columns: 2.6rem minmax(0, 1fr) auto;
  gap: var(--s-3);
  align-items: center;
}
.co-line__img {
  width: 2.6rem;
  height: 2.6rem;
  overflow: hidden;
  border: var(--line-w) solid var(--line);
  border-radius: var(--radius);
  background: var(--bg);
}
.co-line__img img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.co-line__name {
  display: block;
  font-size: var(--step--1);
  font-weight: 600;
  line-height: 1.3;
}
.co-line__meta {
  display: block;
  font-size: var(--step--2);
  color: var(--text-2);
}
.co-line__total {
  font-size: var(--step--1);
  white-space: nowrap;
}
.co-totals {
  display: grid;
  gap: var(--s-1);
  margin-top: var(--s-4);
  padding-top: var(--s-3);
  border-top: var(--line-w) solid var(--line);
  font-size: var(--step--1);
}
.co-totals__row {
  display: flex;
  justify-content: space-between;
  gap: var(--s-3);
}
.co-totals__row span:last-child {
  font-variant-numeric: tabular-nums;
}
.co-totals__hint {
  padding: var(--s-1) var(--s-2);
  border-radius: var(--radius);
  background: var(--success-soft);
  color: var(--success);
}
.co-totals__grand {
  padding-top: var(--s-2);
  font-size: var(--step-1);
  font-weight: 700;
}

/* Confirmation */
.confirmation {
  max-width: 48rem;
  padding-block: var(--s-6);
}
.confirmation__title {
  margin-block: var(--s-4) var(--s-2);
}
.confirmation__grid {
  display: grid;
  gap: var(--s-4);
  margin-block: var(--s-5);
}
@media (min-width: 40rem) {
  .confirmation__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.confirmation__block h2 {
  font-size: var(--step-0);
  margin-bottom: var(--s-1);
}
```

In `src/main.tsx`, after `import "./styles/catalog.css";` add `import "./styles/checkout.css";`.

- [ ] **Step 4: Typecheck, build, commit**

```bash
pnpm -F @viu/emporix-examples-storefront-demo typecheck
pnpm -F @viu/emporix-examples-storefront-demo build
git add examples/storefront-demo/src
git commit -m "feat(examples): add the checkout accordion and order summary" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Contact step

**Files:**
- Create: `src/checkout/ContactStep.tsx`

**Interfaces:**
- Consumes: `useCustomerSession()` (`isAuthenticated`, `saasToken`, `customer`, `login`), `Field`, `Button`, `Alert`, `errorMessage`.
- Produces:
  - `interface ContactDraft { email: string; firstName: string; lastName: string }`
  - `contactErrors(c: ContactDraft): Partial<Record<keyof ContactDraft, string>>`
  - `ContactStep({ value: ContactDraft; onChange: (patch: Partial<ContactDraft>) => void; onContinue: () => void })` — a guest gets the fields; a signed-in customer with a complete profile gets a card (spec, step 1); one without a `saasToken` gets the sign-in form

- [ ] **Step 1: Create `src/checkout/ContactStep.tsx`**

```tsx
import { useState } from "react";
import type { FormEvent } from "react";
import { useCustomerSession } from "@viu/emporix-sdk-react";
import { Field } from "../components/ui/Field";
import { Button } from "../components/ui/Button";
import { Alert } from "../components/ui/Alert";
import { errorMessage } from "../app/Toasts";

export interface ContactDraft {
  email: string;
  firstName: string;
  lastName: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What is missing from a contact, by field; empty when complete. */
export function contactErrors(c: ContactDraft): Partial<Record<keyof ContactDraft, string>> {
  const e: Partial<Record<keyof ContactDraft, string>> = {};
  if (!EMAIL.test(c.email.trim())) e.email = "Enter a valid email address.";
  if (!c.firstName.trim()) e.firstName = "Required.";
  if (!c.lastName.trim()) e.lastName = "Required.";
  return e;
}

/**
 * Step 1. A guest types email and name, or signs in instead. A signed-in customer
 * sees the profile's values; if the in-memory `saasToken` is gone (a reload
 * clears it), only signing in again unlocks the order, because Emporix requires
 * that token for a customer order.
 */
export function ContactStep({
  value,
  onChange,
  onContinue,
}: {
  value: ContactDraft;
  onChange: (patch: Partial<ContactDraft>) => void;
  onContinue: () => void;
}) {
  const { isAuthenticated, saasToken, customer, login } = useCustomerSession();
  const [mode, setMode] = useState<"guest" | "login">("guest");
  const [touched, setTouched] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  // Annotated: without it the type is a union with `{}` and `errors.email` does not compile.
  const errors: Partial<Record<keyof ContactDraft, string>> = touched ? contactErrors(value) : {};
  const accountEmail = (customer as { contactEmail?: string } | null)?.contactEmail ?? value.email;
  const set = (k: keyof ContactDraft) => (e: { target: { value: string } }) => onChange({ [k]: e.target.value });

  async function signIn(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setLoginError(null);
    try {
      await login({ email: isAuthenticated ? accountEmail : loginEmail, password });
      setPassword("");
      setMode("guest");
    } catch (err) {
      setLoginError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function next(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(contactErrors(value)).length === 0) onContinue();
  }

  const needsToken = isAuthenticated && !saasToken;
  if (needsToken || mode === "login") {
    return (
      <form onSubmit={signIn} className="stack" noValidate>
        {needsToken ? (
          <>
            <Alert tone="warning">
              <strong>Sign in again to place the order.</strong> Your session survived the reload, but the token Emporix
              needs for a customer order is kept in memory only.
            </Alert>
            <p>
              Signed in as <strong>{accountEmail}</strong>
            </p>
          </>
        ) : (
          <Field label="Email" type="email" autoComplete="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} />
        )}
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {loginError ? <Alert tone="danger">{loginError}</Alert> : null}
        <div className="co-actions">
          <Button type="submit" variant="accent" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
          {!needsToken ? (
            <Button type="button" variant="ghost" onClick={() => setMode("guest")}>
              Check out as a guest
            </Button>
          ) : null}
        </div>
      </form>
    );
  }

  // A signed-in customer whose profile is complete sees a card; one with a gap in
  // the profile gets the fields below, prefilled and with the email locked.
  if (isAuthenticated && Object.keys(contactErrors(value)).length === 0) {
    return (
      <form onSubmit={next} className="stack" noValidate>
        <div className="co-card">
          <strong>
            {value.firstName} {value.lastName}
          </strong>
          <span className="muted">{value.email}</span>
        </div>
        <div className="co-actions">
          <Button type="submit" variant="accent">
            Continue to shipping address
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={next} className="stack" noValidate>
      <Field
        label="Email"
        type="email"
        autoComplete="email"
        value={value.email}
        onChange={set("email")}
        error={errors.email}
        disabled={isAuthenticated}
      />
      <div className="form-grid form-grid--2">
        <Field label="First name" autoComplete="given-name" value={value.firstName} onChange={set("firstName")} error={errors.firstName} />
        <Field label="Last name" autoComplete="family-name" value={value.lastName} onChange={set("lastName")} error={errors.lastName} />
      </div>
      <div className="co-actions">
        <Button type="submit" variant="accent">
          Continue to shipping address
        </Button>
        {!isAuthenticated ? (
          <Button type="button" variant="ghost" onClick={() => setMode("login")}>
            Have an account? Sign in
          </Button>
        ) : null}
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Typecheck, build, commit**

```bash
pnpm -F @viu/emporix-examples-storefront-demo typecheck
pnpm -F @viu/emporix-examples-storefront-demo build
git add examples/storefront-demo/src/checkout/ContactStep.tsx
git commit -m "feat(examples): add the checkout contact step" \
  -m "A guest's email and name are required and start empty. A customer whose
saasToken a reload has cleared must sign in again here, before the order can
fail on it." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Address fields, picker and step

**Files:**
- Modify: `src/checkout/AddressFields.tsx`, `src/checkout/AddressSection.tsx` (import `addressToDraft` instead of its own copy)
- Create: `src/checkout/AddressPicker.tsx`, `src/checkout/AddressStep.tsx`

**Interfaces:**
- Consumes: `countryName` (Task 4), `RadioCard` (Task 2), `Field`, `SelectField`, `Button`.
- Produces:
  - `type AddressDraft` (unchanged fields), `type AddressErrors = Partial<Record<"contactName" | "street" | "zipCode" | "city" | "country", string>>`, `EMPTY_ADDRESS`
  - `addressToDraft(a: Address): AddressDraft`, `addressErrors(a: AddressDraft, countries: string[]): AddressErrors`, `formatAddress(a: AddressDraft): string`
  - `AddressFields({ value; onChange; idPrefix: string; countries?: string[] | undefined; errors?: AddressErrors | undefined })` — the two new props are optional so the PR 1 checkout keeps compiling until Task 15
  - `AddressPicker({ value: AddressDraft; onChange: (patch: Partial<AddressDraft>) => void; saved: Address[]; countries: string[]; idPrefix: string; errors: AddressErrors })`
  - `AddressStep({ value: AddressDraft; onChange: (patch: Partial<AddressDraft>) => void; saved: Address[]; countries: string[]; onContinue: () => void })`

- [ ] **Step 1: Replace `src/checkout/AddressFields.tsx`**

```tsx
import type { Address } from "@viu/emporix-sdk";
import { Field, SelectField } from "../components/ui/Field";
import { countryName } from "../lib/countries";

export type AddressDraft = {
  contactName: string;
  companyName?: string;
  street: string;
  streetNumber?: string;
  zipCode: string;
  city: string;
  country: string;
  contactPhone?: string;
};

export type AddressErrors = Partial<Record<"contactName" | "street" | "zipCode" | "city" | "country", string>>;

/** A blank address draft. Spread into `useState` so optional fields are "". */
export const EMPTY_ADDRESS: AddressDraft = {
  contactName: "",
  companyName: "",
  street: "",
  streetNumber: "",
  zipCode: "",
  city: "",
  country: "",
  contactPhone: "",
};

/** Maps a saved customer `Address` onto an editable `AddressDraft`. */
export function addressToDraft(a: Address): AddressDraft {
  return {
    contactName: a.contactName ?? "",
    companyName: a.companyName ?? "",
    street: a.street ?? "",
    streetNumber: a.streetNumber ?? "",
    zipCode: a.zipCode ?? "",
    city: a.city ?? "",
    country: a.country ?? "",
    contactPhone: a.contactPhone ?? "",
  };
}

/** Required fields that are missing, and a country the site does not ship to. */
export function addressErrors(a: AddressDraft, countries: string[]): AddressErrors {
  const e: AddressErrors = {};
  if (!a.contactName.trim()) e.contactName = "Required.";
  if (!a.street.trim()) e.street = "Required.";
  if (!a.zipCode.trim()) e.zipCode = "Required.";
  if (!a.city.trim()) e.city = "Required.";
  if (!a.country) e.country = "Required.";
  else if (countries.length > 0 && !countries.includes(a.country)) {
    e.country = `This site does not ship to ${countryName(a.country)}.`;
  }
  return e;
}

/** One line for summaries: name, street, place, country. */
export function formatAddress(a: AddressDraft): string {
  return [
    a.contactName,
    [a.street, a.streetNumber].filter(Boolean).join(" "),
    [a.zipCode, a.city].filter(Boolean).join(" "),
    a.country ? countryName(a.country) : "",
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * Pure, controlled address field set. The parent owns the draft and receives
 * single-field patches; `idPrefix` keeps ids unique when shipping and billing
 * render on one page. The country is a select over the site's ship-to countries.
 */
export function AddressFields({
  value,
  onChange,
  idPrefix,
  countries = [],
  errors = {},
}: {
  value: AddressDraft;
  onChange: (patch: Partial<AddressDraft>) => void;
  idPrefix: string;
  countries?: string[] | undefined;
  errors?: AddressErrors | undefined;
}) {
  const set =
    (k: keyof AddressDraft) =>
    (e: { target: { value: string } }) =>
      onChange({ [k]: e.target.value });
  // A saved address may name a country the site does not list; keep it
  // selectable so the error can say so instead of the value silently vanishing.
  const options = value.country && !countries.includes(value.country) ? [...countries, value.country] : countries;
  return (
    <div className="form-grid">
      <Field
        id={`${idPrefix}-contactName`}
        label="Contact name"
        required
        value={value.contactName}
        onChange={set("contactName")}
        autoComplete="name"
        error={errors.contactName}
      />
      <Field
        id={`${idPrefix}-companyName`}
        label="Company (optional)"
        value={value.companyName ?? ""}
        onChange={set("companyName")}
        autoComplete="organization"
      />
      <div className="form-grid form-grid--street">
        <Field
          id={`${idPrefix}-street`}
          label="Street"
          required
          value={value.street}
          onChange={set("street")}
          autoComplete="address-line1"
          error={errors.street}
        />
        <Field id={`${idPrefix}-streetNumber`} label="No." value={value.streetNumber ?? ""} onChange={set("streetNumber")} />
      </div>
      <div className="form-grid form-grid--city">
        <Field
          id={`${idPrefix}-zipCode`}
          label="Postcode"
          required
          value={value.zipCode}
          onChange={set("zipCode")}
          autoComplete="postal-code"
          error={errors.zipCode}
        />
        <Field
          id={`${idPrefix}-city`}
          label="City"
          required
          value={value.city}
          onChange={set("city")}
          autoComplete="address-level2"
          error={errors.city}
        />
      </div>
      <div className="field">
        <SelectField id={`${idPrefix}-country`} label="Country" required value={value.country} onChange={set("country")} autoComplete="country">
          <option value="" disabled>
            Choose a country
          </option>
          {options.map((c) => (
            <option key={c} value={c}>
              {countryName(c)}
            </option>
          ))}
        </SelectField>
        {errors.country ? <span className="field__error">{errors.country}</span> : null}
      </div>
      <Field
        id={`${idPrefix}-contactPhone`}
        label="Phone (optional)"
        value={value.contactPhone ?? ""}
        onChange={set("contactPhone")}
        autoComplete="tel"
      />
    </div>
  );
}
```

In `src/checkout/AddressSection.tsx` delete its local `addressToDraft` function and change its import to `import { AddressFields, addressToDraft, type AddressDraft } from "./AddressFields";`.

- [ ] **Step 2: Create `src/checkout/AddressPicker.tsx`**

```tsx
import { useState } from "react";
import type { Address } from "@viu/emporix-sdk";
import { RadioCard } from "../components/ui/RadioCard";
import {
  AddressFields,
  EMPTY_ADDRESS,
  addressToDraft,
  formatAddress,
  type AddressDraft,
  type AddressErrors,
} from "./AddressFields";

function matches(a: Address, d: AddressDraft): boolean {
  return (
    (a.contactName ?? "") === d.contactName &&
    (a.street ?? "") === d.street &&
    (a.zipCode ?? "") === d.zipCode &&
    (a.city ?? "") === d.city
  );
}

/**
 * Saved addresses as radio cards plus «New address», or the bare form when
 * there is nothing saved (always the case for a guest).
 */
export function AddressPicker({
  value,
  onChange,
  saved,
  countries,
  idPrefix,
  errors,
}: {
  value: AddressDraft;
  onChange: (patch: Partial<AddressDraft>) => void;
  saved: Address[];
  countries: string[];
  idPrefix: string;
  errors: AddressErrors;
}) {
  // "new" = the form; otherwise the id of the saved address in use.
  const [picked, setPicked] = useState<string>(() => saved.find((a) => matches(a, value))?.id ?? "new");
  const showForm = saved.length === 0 || picked === "new";
  return (
    <div className="stack">
      {saved.length > 0 ? (
        <div className="radio-list">
          {saved.map((a) =>
            a.id ? (
              <RadioCard
                key={a.id}
                name={`${idPrefix}-address`}
                value={a.id}
                checked={picked === a.id}
                onChange={(id) => {
                  setPicked(id);
                  onChange(addressToDraft(a));
                }}
                title={a.contactName ?? "Saved address"}
                description={formatAddress(addressToDraft(a))}
                aside={a.isDefault ? "Default" : undefined}
              />
            ) : null,
          )}
          <RadioCard
            name={`${idPrefix}-address`}
            value="new"
            checked={picked === "new"}
            onChange={() => {
              setPicked("new");
              onChange({ ...EMPTY_ADDRESS, contactName: value.contactName, country: countries[0] ?? "" });
            }}
            title="New address"
          />
        </div>
      ) : null}
      {showForm ? <AddressFields value={value} onChange={onChange} idPrefix={idPrefix} countries={countries} errors={errors} /> : null}
    </div>
  );
}
```

- [ ] **Step 3: Create `src/checkout/AddressStep.tsx`**

```tsx
import { useState } from "react";
import type { Address } from "@viu/emporix-sdk";
import { Button } from "../components/ui/Button";
import { AddressPicker } from "./AddressPicker";
import { addressErrors, type AddressDraft } from "./AddressFields";

/** Step 2: where the order goes. Errors appear once «Continue» was pressed. */
export function AddressStep({
  value,
  onChange,
  saved,
  countries,
  onContinue,
}: {
  value: AddressDraft;
  onChange: (patch: Partial<AddressDraft>) => void;
  saved: Address[];
  countries: string[];
  onContinue: () => void;
}) {
  const [touched, setTouched] = useState(false);
  const errors = touched ? addressErrors(value, countries) : {};
  function next() {
    setTouched(true);
    if (Object.keys(addressErrors(value, countries)).length === 0) onContinue();
  }
  return (
    <div>
      <AddressPicker value={value} onChange={onChange} saved={saved} countries={countries} idPrefix="shipping" errors={errors} />
      <div className="co-actions">
        <Button variant="accent" onClick={next}>
          Continue to delivery
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck, build, commit**

```bash
pnpm -F @viu/emporix-examples-storefront-demo typecheck
pnpm -F @viu/emporix-examples-storefront-demo build
git add examples/storefront-demo/src/checkout
git commit -m "feat(examples): add the checkout address step" \
  -m "Required fields with their error next to them, the country as a select
over the site's ship-to countries, and saved addresses as radio cards with the
default preselected." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Delivery and payment steps

**Files:**
- Create: `src/checkout/DeliveryStep.tsx`, `src/checkout/PaymentStep.tsx`

**Interfaces:**
- Consumes: `DeliveryChoice`, `freeFrom` (Task 10); `AddressPicker`, `addressErrors`, `AddressDraft` (Task 13); `countryName` (Task 4); `useShippingZones`; `resolveZone`, `pickFee`, `ShippingMethod`, `PaymentMode`, `Address` from the SDK; `pickText` from `../lib/adapters`.
- Produces:
  - `useDeliveryOptions(country: string, itemsTotal: number | undefined): { options: DeliveryChoice[]; isLoading: boolean }`
  - `fallbackDelivery(country: string): DeliveryChoice`
  - `DeliveryStep({ options: DeliveryChoice[]; isLoading: boolean; country: string; currency: string; value: string | null; onChange: (methodId: string) => void; onContinue: () => void })`
  - `interface PaymentDraft { modeId: string | null; billingSame: boolean; billing: AddressDraft }`
  - `modeLabel(m: PaymentMode): string`
  - `PaymentStep({ modes: PaymentMode[]; isLoading: boolean; value: PaymentDraft; onChange: (patch: Partial<PaymentDraft>) => void; saved: Address[]; countries: string[]; onContinue: () => void })`

- [ ] **Step 1: Create `src/checkout/DeliveryStep.tsx`**

```tsx
import { useMemo } from "react";
import { useShippingZones } from "@viu/emporix-sdk-react";
import { pickFee, resolveZone } from "@viu/emporix-sdk";
import { money } from "@viu/emporix-examples-shared";
import { pickText } from "../lib/adapters";
import { countryName } from "../lib/countries";
import { Alert } from "../components/ui/Alert";
import { Button } from "../components/ui/Button";
import { RadioCard } from "../components/ui/RadioCard";
import { Spinner } from "../components/ui/Spinner";
import { freeFrom, type DeliveryChoice } from "./totals";

/**
 * The methods of the zone that ships to `country`, each priced from its fee
 * table at the current items total. Lives outside the step so the checkout can
 * preselect a method before step 3 ever opens.
 */
export function useDeliveryOptions(
  country: string,
  itemsTotal: number | undefined,
): { options: DeliveryChoice[]; isLoading: boolean } {
  const { data: zones, isLoading } = useShippingZones();
  const options = useMemo(() => {
    const zone = resolveZone(zones, country);
    const zoneId = zone?.id;
    if (!zone || !zoneId) return [];
    return (zone.methods ?? [])
      .filter((m) => m.active !== false && (m.fees?.length ?? 0) > 0)
      .flatMap((m): DeliveryChoice[] => {
        const fee = pickFee(m.fees, itemsTotal ?? 0);
        const methodId = m.id;
        if (!fee || !methodId) return [];
        const free = freeFrom(m.fees);
        return [
          {
            methodId,
            zoneId,
            methodName: pickText(m.name, methodId),
            amount: fee.cost.amount,
            ...(m.shippingTaxCode ? { shippingTaxCode: m.shippingTaxCode } : {}),
            ...(free !== undefined ? { freeFrom: free } : {}),
          },
        ];
      });
  }, [zones, country, itemsTotal]);
  return { options, isLoading };
}

/** What the order goes out with when no method resolves: the pre-redesign behaviour, now stated in the step. */
export function fallbackDelivery(country: string): DeliveryChoice {
  return { methodId: "free", zoneId: country, methodName: "Free Shipping", amount: 0 };
}

/** Step 3: one radio card per method, with its price and free-delivery threshold. */
export function DeliveryStep({
  options,
  isLoading,
  country,
  currency,
  value,
  onChange,
  onContinue,
}: {
  options: DeliveryChoice[];
  isLoading: boolean;
  country: string;
  currency: string;
  value: string | null;
  onChange: (methodId: string) => void;
  onContinue: () => void;
}) {
  return (
    <div>
      {isLoading ? (
        <Spinner label="Loading delivery options" />
      ) : options.length === 0 ? (
        <Alert tone="warning">
          No delivery method is configured for {countryName(country)} on this site. The order goes out with a
          free-shipping placeholder (<code>methodId: "free"</code>).
        </Alert>
      ) : (
        <div className="radio-list">
          {options.map((o) => (
            <RadioCard
              key={o.methodId}
              name="delivery"
              value={o.methodId}
              checked={value === o.methodId}
              onChange={onChange}
              title={o.methodName}
              description={o.freeFrom !== undefined ? `Free from ${money(o.freeFrom, currency)}` : undefined}
              aside={o.amount === 0 ? "Free" : money(o.amount, currency)}
            />
          ))}
        </div>
      )}
      <div className="co-actions">
        <Button variant="accent" onClick={onContinue} disabled={isLoading}>
          Continue to payment
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/checkout/PaymentStep.tsx`**

```tsx
import { useState } from "react";
import type { Address, PaymentMode } from "@viu/emporix-sdk";
import { Alert } from "../components/ui/Alert";
import { Button } from "../components/ui/Button";
import { RadioCard } from "../components/ui/RadioCard";
import { Spinner } from "../components/ui/Spinner";
import { AddressPicker } from "./AddressPicker";
import { addressErrors, type AddressDraft } from "./AddressFields";

export interface PaymentDraft {
  modeId: string | null;
  billingSame: boolean;
  billing: AddressDraft;
}

/** A readable name for a payment mode: `invoice` → «Invoice», `cash_on_delivery` → «Cash on delivery». */
export function modeLabel(m: PaymentMode): string {
  const words = (m.code ?? m.id ?? "payment").replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

/** Step 4: the tenant's payment modes and the billing address. */
export function PaymentStep({
  modes,
  isLoading,
  value,
  onChange,
  saved,
  countries,
  onContinue,
}: {
  modes: PaymentMode[];
  isLoading: boolean;
  value: PaymentDraft;
  onChange: (patch: Partial<PaymentDraft>) => void;
  saved: Address[];
  countries: string[];
  onContinue: () => void;
}) {
  const [touched, setTouched] = useState(false);
  const billingErrors = touched && !value.billingSame ? addressErrors(value.billing, countries) : {};
  function next() {
    setTouched(true);
    if (value.billingSame || Object.keys(addressErrors(value.billing, countries)).length === 0) onContinue();
  }
  return (
    <div>
      {isLoading ? (
        <Spinner label="Loading payment options" />
      ) : modes.length === 0 ? (
        <Alert tone="warning">
          No payment mode is configured for this tenant. The order goes out with the demo <code>custom</code> provider
          and stays <code>IN_CHECKOUT</code>.
        </Alert>
      ) : (
        <div className="radio-list">
          {modes.map((m) =>
            m.id ? (
              <RadioCard
                key={m.id}
                name="payment"
                value={m.id}
                checked={value.modeId === m.id}
                onChange={(id) => onChange({ modeId: id })}
                title={modeLabel(m)}
              />
            ) : null,
          )}
        </div>
      )}
      <label className="co-check">
        <input type="checkbox" checked={value.billingSame} onChange={(e) => onChange({ billingSame: e.target.checked })} />
        <span>Billing address same as shipping</span>
      </label>
      {!value.billingSame ? (
        <div className="co-step__body">
          <AddressPicker
            value={value.billing}
            onChange={(patch) => onChange({ billing: { ...value.billing, ...patch } })}
            saved={saved}
            countries={countries}
            idPrefix="billing"
            errors={billingErrors}
          />
        </div>
      ) : null}
      <div className="co-actions">
        <Button variant="accent" onClick={next} disabled={isLoading}>
          Review order
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck, build, commit**

```bash
pnpm -F @viu/emporix-examples-storefront-demo typecheck
pnpm -F @viu/emporix-examples-storefront-demo build
git add examples/storefront-demo/src/checkout
git commit -m "feat(examples): add the checkout delivery and payment steps" \
  -m "Delivery methods as radio cards with their fee and free-delivery
threshold, payment modes by readable name, and the fallbacks that applied
silently before now stated in the step." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Review, confirmation and the checkout page

**Files:**
- Create: `src/checkout/ReviewStep.tsx`, `src/checkout/Confirmation.tsx`
- Rewrite: `src/pages/Checkout.tsx`
- Delete: `src/checkout/AddressSection.tsx`, `src/checkout/ShippingSelector.tsx`, `src/checkout/PaymentSelector.tsx`

**Interfaces:**
- Consumes: everything from Tasks 10–14; `useActiveCart`, `useActiveSite`, `useCheckout`, `useCustomerAddresses`, `useCustomerSession`, `useEmporix`, `usePaymentModes`; `EmporixError`, `EmporixNotFoundError`, `PaymentMode`.
- Produces:
  - `ReviewStep({ rows: ReviewRow[]; total: string; tenant: string; busy: boolean; error: SubmitError | null; onPlace: () => void })`, `interface ReviewRow { step: number; label: string; value: string; onEdit: () => void }`, `interface SubmitError { message: string; toCart: boolean }`
  - `Confirmation({ order: PlacedOrder })`, `interface PlacedOrder { orderId: string; email: string; lines: CartLineVM[]; details: Record<string, ProductDetails>; totals: CheckoutTotals; shipping: AddressDraft; deliveryName: string; paymentLabel: string; signedIn: boolean }`

- [ ] **Step 1: Create `src/checkout/ReviewStep.tsx`**

```tsx
import { Link } from "react-router-dom";
import { Alert } from "../components/ui/Alert";
import { Button } from "../components/ui/Button";

export interface ReviewRow {
  step: number;
  label: string;
  value: string;
  onEdit: () => void;
}

export interface SubmitError {
  message: string;
  /** The cart is gone or already ordered: offer the way back. */
  toCart: boolean;
}

/** Step 5: everything in one place, the live-order warning at the button. */
export function ReviewStep({
  rows,
  total,
  tenant,
  busy,
  error,
  onPlace,
}: {
  rows: ReviewRow[];
  total: string;
  tenant: string;
  busy: boolean;
  error: SubmitError | null;
  onPlace: () => void;
}) {
  return (
    <div className="stack">
      <div className="co-review">
        {rows.map((r) => (
          <div key={r.step} className="co-review__block">
            <span className="co-review__label">{r.label}</span>
            <span className="co-review__value">{r.value}</span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={r.onEdit} aria-label={`Edit ${r.label}`}>
              Edit
            </button>
          </div>
        ))}
      </div>
      <Alert tone="warning">
        <strong>Live order.</strong> Placing it creates a real order in tenant <strong>{tenant}</strong>.
      </Alert>
      {error ? (
        <Alert tone="danger">
          {error.message}
          {error.toCart ? (
            <>
              {" "}
              <Link to="/cart" className="u-underline">
                Back to the cart
              </Link>
            </>
          ) : null}
        </Alert>
      ) : null}
      <Button variant="accent" block onClick={onPlace} disabled={busy}>
        {busy ? "Placing order…" : `Place order · ${total}`}
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/checkout/Confirmation.tsx`**

```tsx
import { Link } from "react-router-dom";
import { Alert } from "../components/ui/Alert";
import type { CartLineVM } from "../lib/adapters";
import type { ProductDetails } from "../lib/useProductNames";
import { formatAddress, type AddressDraft } from "./AddressFields";
import { OrderSummary } from "./OrderSummary";
import type { CheckoutTotals } from "./totals";

/** A snapshot taken just before submit: after the order the cart is closed. */
export interface PlacedOrder {
  orderId: string;
  email: string;
  lines: CartLineVM[];
  details: Record<string, ProductDetails>;
  totals: CheckoutTotals;
  shipping: AddressDraft;
  deliveryName: string;
  paymentLabel: string;
  signedIn: boolean;
}

export function Confirmation({ order }: { order: PlacedOrder }) {
  return (
    <div className="container confirmation">
      <Alert tone="success">
        <strong>Order placed.</strong> Order number <strong>{order.orderId}</strong>.
      </Alert>
      <h1 className="confirmation__title">Thank you</h1>
      <p className="muted">The order was created for {order.email}.</p>
      <div className="confirmation__grid">
        <div className="confirmation__block">
          <h2>Shipping address</h2>
          <p className="muted">{formatAddress(order.shipping)}</p>
        </div>
        <div className="confirmation__block">
          <h2>Delivery and payment</h2>
          <p className="muted">
            {order.deliveryName} · {order.paymentLabel}
          </p>
        </div>
      </div>
      <OrderSummary lines={order.lines} details={order.details} totals={order.totals} deliveryName={order.deliveryName} />
      <div className="co-actions">
        {order.signedIn ? (
          // Guests cannot open it: OrderDetail sits behind RequireAuth.
          <Link to={`/account/orders/${encodeURIComponent(order.orderId)}`} className="btn btn--accent">
            View order
          </Link>
        ) : null}
        <Link to="/" className="btn btn--outline">
          Continue shopping
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Replace `src/pages/Checkout.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { EmporixError, EmporixNotFoundError } from "@viu/emporix-sdk";
import type { PaymentMode } from "@viu/emporix-sdk";
import {
  useActiveCart,
  useActiveSite,
  useCheckout,
  useCustomerAddresses,
  useCustomerSession,
  useEmporix,
  usePaymentModes,
} from "@viu/emporix-sdk-react";
import { money } from "@viu/emporix-examples-shared";
import { cartLines } from "../lib/adapters";
import { useProductDetails } from "../lib/useProductNames";
import { Loading } from "../components/ui/Spinner";
import { EmptyState } from "../components/ui/EmptyState";
import { errorMessage } from "../app/Toasts";
import { CheckoutStep, type StepState } from "../checkout/CheckoutStep";
import { ContactStep, contactErrors, type ContactDraft } from "../checkout/ContactStep";
import { AddressStep } from "../checkout/AddressStep";
import { DeliveryStep, fallbackDelivery, useDeliveryOptions } from "../checkout/DeliveryStep";
import { PaymentStep, modeLabel, type PaymentDraft } from "../checkout/PaymentStep";
import { ReviewStep, type SubmitError } from "../checkout/ReviewStep";
import { OrderSummary } from "../checkout/OrderSummary";
import { Confirmation, type PlacedOrder } from "../checkout/Confirmation";
import { EMPTY_ADDRESS, addressErrors, addressToDraft, formatAddress, type AddressDraft } from "../checkout/AddressFields";
import { checkoutTotals } from "../checkout/totals";

type Step = 1 | 2 | 3 | 4 | 5;
type FormStep = Exclude<Step, 5>;
const TITLES: Record<Step, string> = {
  1: "Contact",
  2: "Shipping address",
  3: "Delivery",
  4: "Payment",
  5: "Review & place order",
};
type ReadCustomer = { id?: string; firstName?: string; lastName?: string; contactEmail?: string };

export function Checkout() {
  const { storage, client } = useEmporix();
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  // Once the order is placed the cart is closed — stop bootstrapping, otherwise
  // `getCurrent` re-adopts the just-closed cart id and every later fetch 404s.
  const { data: cart, isLoading } = useActiveCart({ create: placed === null });
  const { isAuthenticated, customer, saasToken } = useCustomerSession();
  const { placeOrder } = useCheckout();
  const site = useActiveSite();
  const countries = site?.shipToCountries ?? [];
  const firstCountry = countries[0];
  // Idle (data undefined) for guests: no saved addresses.
  const { data: savedData } = useCustomerAddresses();
  const saved = savedData ?? [];
  const { data: modesData, isLoading: modesLoading } = usePaymentModes();
  const modes: PaymentMode[] = modesData ?? [];

  const cartId = (cart as { id?: string } | null)?.id;
  const lines = cartLines(cart);
  const details = useProductDetails(lines.map((l) => l.productId));
  const cust = customer as ReadCustomer | null;

  const [step, setStep] = useState<Step>(1);
  const [reached, setReached] = useState<Step>(1);
  const [contact, setContact] = useState<ContactDraft>({ email: "", firstName: "", lastName: "" });
  const [shipping, setShipping] = useState<AddressDraft>({ ...EMPTY_ADDRESS });
  const [deliveryId, setDeliveryId] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentDraft>({ modeId: null, billingSame: true, billing: { ...EMPTY_ADDRESS } });
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);

  // Prefill from the profile once it loads; what the shopper typed wins.
  useEffect(() => {
    if (!cust) return;
    setContact((c) => ({
      email: c.email || cust.contactEmail || "",
      firstName: c.firstName || cust.firstName || "",
      lastName: c.lastName || cust.lastName || "",
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cust?.id]);

  // The default saved address, else the site's first country.
  const defaultSaved = saved.find((a) => a.isDefault) ?? saved[0];
  useEffect(() => {
    if (defaultSaved) setShipping((s) => (s.street ? s : addressToDraft(defaultSaved)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultSaved?.id]);
  useEffect(() => {
    if (firstCountry) setShipping((s) => (s.country ? s : { ...s, country: firstCountry }));
  }, [firstCountry]);

  const itemsTotal = checkoutTotals(cart, null)?.total;
  const shipCountry = shipping.country || firstCountry || "";
  const { options, isLoading: optionsLoading } = useDeliveryOptions(shipCountry, itemsTotal);
  // The first method is preselected; the fallback only once nothing resolved.
  const delivery =
    options.find((o) => o.methodId === deliveryId) ?? options[0] ?? (optionsLoading ? null : fallbackDelivery(shipCountry));
  const totals = checkoutTotals(cart, delivery);
  const modeId = payment.modeId ?? modes[0]?.id ?? null;
  const mode = modes.find((m) => m.id === modeId);
  const paymentLabel = mode ? modeLabel(mode) : "Custom (demo)";
  const billingLabel = payment.billingSame ? "billing same as shipping" : `billing ${formatAddress(payment.billing)}`;

  const valid: Record<FormStep, boolean> = {
    1: Object.keys(contactErrors(contact)).length === 0 && (!isAuthenticated || Boolean(saasToken)),
    2: Object.keys(addressErrors(shipping, countries)).length === 0,
    3: delivery !== null,
    4: !modesLoading && (payment.billingSame || Object.keys(addressErrors(payment.billing, countries)).length === 0),
  };

  // A returning customer with everything on file starts at the review — once,
  // after the prefill effects above have applied.
  const jumped = useRef(false);
  const prefilled = (!cust || Boolean(contact.email)) && (!defaultSaved || Boolean(shipping.street));
  const ready = !isLoading && !optionsLoading && !modesLoading && savedData !== undefined && prefilled;
  useEffect(() => {
    if (jumped.current || !isAuthenticated || !ready) return;
    jumped.current = true;
    if (valid[1] && valid[2] && valid[3] && valid[4]) {
      setStep(5);
      setReached(5);
    }
  });

  function go(s: Step) {
    setStep(s);
    setReached((r) => (s > r ? s : r));
    setSubmitError(null);
  }
  function continueFrom(s: FormStep) {
    if (s === 1 && !shipping.contactName) {
      setShipping((a) => ({ ...a, contactName: `${contact.firstName} ${contact.lastName}`.trim() }));
    }
    const later: Step[] = [2, 3, 4, 5];
    go(later.find((n) => n > s && (n === 5 || n > reached || !valid[n as FormStep])) ?? 5);
  }
  const stateOf = (s: Step): StepState => (s === step ? "open" : s !== 5 && s <= reached && valid[s] ? "done" : "todo");

  async function place() {
    if (!cartId || !totals || !delivery) return;
    setSubmitError(null);
    const billing = payment.billingSame ? shipping : payment.billing;
    const toAddress = (a: AddressDraft, type: "SHIPPING" | "BILLING") => ({
      contactName: a.contactName,
      ...(a.companyName ? { companyName: a.companyName } : {}),
      street: a.street,
      ...(a.streetNumber ? { streetNumber: a.streetNumber } : {}),
      zipCode: a.zipCode,
      city: a.city,
      country: a.country,
      ...(a.contactPhone ? { contactPhone: a.contactPhone } : {}),
      type,
    });
    const input = {
      cartId,
      customer: {
        // A signed-in customer must be identified by id; a guest must not.
        ...(isAuthenticated && cust?.id ? { id: cust.id } : {}),
        email: contact.email,
        firstName: contact.firstName,
        lastName: contact.lastName,
        guest: !isAuthenticated,
      },
      shipping: {
        methodId: delivery.methodId,
        zoneId: delivery.zoneId,
        methodName: delivery.methodName,
        amount: delivery.amount,
        ...(delivery.shippingTaxCode ? { shippingTaxCode: delivery.shippingTaxCode } : {}),
      },
      addresses: [toAddress(shipping, "SHIPPING"), toAddress(billing, "BILLING")],
      // The payment amount is the total the shopper saw: items plus delivery.
      paymentMethods: modeId
        ? [{ provider: "payment-gateway", customAttributes: { modeId }, amount: totals.total }]
        : [{ provider: "custom", amount: totals.total }],
    };
    try {
      const r = await placeOrder.mutateAsync({
        input,
        // A customer checkout must carry the saasToken; a guest's does not.
        ...(isAuthenticated && saasToken ? { saasToken } : {}),
      });
      setPlaced({
        orderId: (r as { orderId?: string }).orderId ?? "",
        email: contact.email,
        lines,
        details,
        totals,
        shipping,
        deliveryName: delivery.methodName,
        paymentLabel,
        signedIn: isAuthenticated,
      });
      // The cart is CLOSED on Emporix after a successful order — drop it locally
      // so `useActiveCart` stops querying the closed cart.
      storage.setCartId(null);
    } catch (err) {
      if (err instanceof EmporixNotFoundError) {
        setSubmitError({ message: "This cart no longer exists. It may have been checked out in another tab.", toCart: true });
      } else if (err instanceof EmporixError && err.status === 409) {
        setSubmitError({ message: "An order already exists for this cart.", toCart: true });
      } else {
        setSubmitError({ message: errorMessage(err), toCart: false });
      }
    }
  }

  if (placed) return <Confirmation order={placed} />;
  if (isLoading) {
    return (
      <div className="container">
        <Loading label="Loading checkout" />
      </div>
    );
  }
  if (lines.length === 0) {
    return (
      <div className="container">
        <EmptyState title="Your cart is empty">
          Add something before checking out — <Link to="/" className="u-underline">browse</Link>.
        </EmptyState>
      </div>
    );
  }

  const currency = totals?.currency ?? "";
  return (
    <div className="container checkout">
      <div className="checkout__head">
        <h1 className="page-title">Checkout</h1>
        <Link to="/cart" className="u-underline">
          ← Back to cart
        </Link>
      </div>
      <div className="co-layout">
        <div className="co-steps">
          <CheckoutStep
            index={1}
            title={TITLES[1]}
            state={stateOf(1)}
            summary={`${contact.email} · ${isAuthenticated ? "signed in" : "guest"}`}
            onEdit={() => go(1)}
          >
            <ContactStep value={contact} onChange={(p) => setContact((c) => ({ ...c, ...p }))} onContinue={() => continueFrom(1)} />
          </CheckoutStep>
          <CheckoutStep index={2} title={TITLES[2]} state={stateOf(2)} summary={formatAddress(shipping)} onEdit={() => go(2)}>
            <AddressStep
              value={shipping}
              onChange={(p) => setShipping((s) => ({ ...s, ...p }))}
              saved={saved}
              countries={countries}
              onContinue={() => continueFrom(2)}
            />
          </CheckoutStep>
          <CheckoutStep
            index={3}
            title={TITLES[3]}
            state={stateOf(3)}
            summary={delivery ? `${delivery.methodName} · ${delivery.amount === 0 ? "Free" : money(delivery.amount, currency)}` : undefined}
            onEdit={() => go(3)}
          >
            <DeliveryStep
              options={options}
              isLoading={optionsLoading}
              country={shipCountry}
              currency={currency}
              value={delivery?.methodId ?? null}
              onChange={setDeliveryId}
              onContinue={() => continueFrom(3)}
            />
          </CheckoutStep>
          <CheckoutStep index={4} title={TITLES[4]} state={stateOf(4)} summary={`${paymentLabel} · ${billingLabel}`} onEdit={() => go(4)}>
            <PaymentStep
              modes={modes}
              isLoading={modesLoading}
              value={{ ...payment, modeId }}
              onChange={(p) => setPayment((x) => ({ ...x, ...p }))}
              saved={saved}
              countries={countries}
              onContinue={() => continueFrom(4)}
            />
          </CheckoutStep>
          <CheckoutStep index={5} title={TITLES[5]} state={stateOf(5)}>
            <ReviewStep
              rows={[
                { step: 1, label: "Contact", value: `${contact.firstName} ${contact.lastName} · ${contact.email}`, onEdit: () => go(1) },
                { step: 2, label: "Ship to", value: formatAddress(shipping), onEdit: () => go(2) },
                { step: 3, label: "Delivery", value: delivery?.methodName ?? "—", onEdit: () => go(3) },
                { step: 4, label: "Payment", value: `${paymentLabel} · ${billingLabel}`, onEdit: () => go(4) },
              ]}
              total={totals ? money(totals.total, totals.currency) : "—"}
              tenant={client.tenant}
              busy={placeOrder.isPending}
              error={submitError}
              onPlace={() => void place()}
            />
          </CheckoutStep>
        </div>
        <OrderSummary lines={lines} details={details} totals={totals} deliveryName={delivery?.methodName} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Delete the replaced components**

```bash
git rm examples/storefront-demo/src/checkout/AddressSection.tsx examples/storefront-demo/src/checkout/ShippingSelector.tsx examples/storefront-demo/src/checkout/PaymentSelector.tsx
grep -rn "AddressSection\|ShippingSelector\|PaymentSelector" examples/storefront-demo/src || echo "ok: no references left"
```

Expected: `ok: no references left`.

- [ ] **Step 5: Gates, typecheck, build**

```bash
grep -rn "style={" examples/storefront-demo/src/checkout examples/storefront-demo/src/pages/Checkout.tsx || echo "ok: checkout has no inline styles"
grep -rn "Rämistrasse\|Guest Shopper\|\"Shopper\"" examples/storefront-demo/src || echo "ok: no invented prefill"
pnpm -F @viu/emporix-examples-storefront-demo typecheck
pnpm -F @viu/emporix-examples-storefront-demo build
```

Expected: both `ok:` lines; typecheck and build exit 0.

- [ ] **Step 6: Commit**

```bash
git add -A examples/storefront-demo/src
git commit -m "feat(examples): place orders from the accordion checkout" \
  -m "Five steps on one route with a summary next to them, and returning
customers start at the review. The payment amount now includes delivery. The
confirmation renders from a snapshot because the cart is closed afterwards,
and offers «View order» only to signed-in customers." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Live check of PR 2, the real order, README, PR 2

- [ ] **Step 1: Guest flow, no order (desktop, then 375px)**

With the dev server and the setup from Task 7 (B2B site), put two or three priced products into the cart and open the checkout. Check and screenshot:
1. Step 1 opens with empty fields; «Continue» with empty fields shows the three errors next to the fields.
2. Step 2: the country select lists the site's ship-to countries; «Continue» with empty fields shows the errors.
3. Step 3: the methods with prices; «Free from CHF 150.00» on the standard method; the summary shows the delivery fee and «Add CHF X for free delivery» while the items cost less than CHF 150; the total equals items plus delivery.
4. Step 4: «Invoice»; unchecking «Billing address same as shipping» opens a second address block.
5. Step 5: the four rows with «Edit»; «Edit» on step 2 reopens it while steps 3 and 4 stay done.
6. At 375px the summary is a bar above the steps that opens the lines.

Stop at step 5. Do **not** press «Place order».

- [ ] **Step 2: Read the live cart's totals (spec, open question 2)**

Use `read_network_requests` with `urlPattern: "/carts/"`, pick the latest `GET …/carts/{id}` (the id is `localStorage["emporix.cartId"]`), and open its response body. Record whether `calculatedPrice.price.grossValue`, `calculatedPrice.finalPrice.grossValue` and `calculatedPrice.finalPrice.taxValue` are present. If `calculatedPrice` is missing, the summary uses `totalPrice` and shows no tax line — that is the designed fallback; note it in the PR.

- [ ] **Step 3: The real order (spec, open question 1) — only with the user's explicit go-ahead now**

Ask the user, naming the tenant, the site and the delivery method: «Place one real guest order on the B2B site with standard delivery to confirm the payment amount including delivery is accepted?» Only on an explicit yes: place it, then record the order number, the confirmation page (screenshot), and from `read_network_requests` the `POST …/checkouts/order` request body (`paymentMethods[0].amount` must equal the shown total) and its response status. If Emporix rejects the amount, apply the spec's fallback (send the items total, as before) and document why in the PR.

- [ ] **Step 4: Customer flow (the user signs in; the agent types no password)**

Ask the user to sign in on the account page, then open the checkout:
1. With a default address on file, the checkout opens at step 5 with steps 1–4 done.
2. Reload the page: step 1 now shows «Sign in again to place the order.» Ask the user to type the password there; afterwards the steps continue.

- [ ] **Step 5: README**

In «Flow checklist» replace the **Checkout** bullet with:

```markdown
- **Checkout** — an accordion of five steps (contact, shipping address,
  delivery, payment, review) for guests **and** signed-in customers; a customer
  with everything on file starts at the review. The summary's total includes
  delivery and is the payment amount. Places a real order, then clears the
  closed cart. The customer path sends the `saas-token` header.
```

In «Things worth knowing» replace the first sentence of the **Customer checkout needs an in-session login.** bullet's explanation so the bullet reads:

```markdown
- **Customer checkout needs an in-session login.** The `saasToken` (required as
  the `saas-token` header) is held in memory only — never persisted. A full page
  reload clears it; the checkout then asks the customer to sign in again in its
  first step instead of failing at «Place order».
```

In «Layout» replace the `checkout/` line with:

```
  checkout/    accordion steps, order summary, totals, confirmation
```

and the `styles/` line with:

```
  styles/      design tokens, base, shell, catalogue and checkout stylesheets
```

- [ ] **Step 6: Full verification, commit, push, PR 2**

```bash
pnpm build && pnpm typecheck && pnpm lint
pnpm -F @viu/emporix-examples-storefront-demo build
git add examples/storefront-demo/README.md
git commit -m "docs(examples): describe the accordion checkout" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u https://github.com/viuteam/emporix-sdk.git feat/storefront-demo-checkout
git fetch https://github.com/viuteam/emporix-sdk.git feat/storefront-demo-checkout:refs/remotes/origin/feat/storefront-demo-checkout
git branch --set-upstream-to=origin/feat/storefront-demo-checkout
gh pr create --base feat/storefront-demo-redesign --head feat/storefront-demo-checkout --label no-release \
  --title "feat(examples): accordion checkout for the storefront demo" \
  --body-file <body.md>
```

The PR body states: the five steps and the returning-customer jump; the payment-amount fix with the evidence from Step 3 (or that no order was placed, if the user declined); the `calculatedPrice` finding from Step 2; the screenshots; that PR 2 is stacked on PR 1 and gets retargeted to `main` after PR 1 merges; and ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Bind it with the session's PR tools, read its CI once, do not poll, and never merge it.
