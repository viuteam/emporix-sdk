# Building a storefront for a pitch

How to get a credible, customer-branded storefront in front of someone quickly,
using what is already in this repo. This is the layer above the examples: which
one to start from, how to reach a shareable URL, how to re-skin it, and how to
fill a tenant with the customer's catalog.

It does not repeat the examples' own docs. Each section links to the file that
owns the detail — [`examples/storefront-demo/README.md`](../examples/storefront-demo/README.md)
in particular already covers running and deploying that demo, and is the
authority for both.

> **Use a sandbox tenant.** Every flow below writes real data — carts, orders,
> customers, products, prices. Never point a pitch at a production tenant.

## 1 — Pick a base

| Base | Reach for it when | What it costs you |
|---|---|---|
| [`storefront-demo`](../examples/storefront-demo) | **default for a pitch** — 17 routes across catalog, cart, checkout and account (15 real screens plus two fallbacks) | nothing to configure: tenant + client id are typed into the running app |
| [`next-server-first`](../examples/next-server-first) | server-first, SEO or «no token in the browser» is part of the story | 6 env values plus a Redis instance before the first page renders |
| [`vite-spa`](../examples/vite-spa) | you want the minimum wiring to read, not a storefront | it is the Playwright harness — changes here can break `pnpm e2e` |

`storefront-demo` wins on time-to-first-render because it has **no build-time
configuration at all**: the setup screen collects tenant, storefront client id,
and optionally host, site code, currency and country, then keeps them in
`localStorage` ([`src/config/SetupScreen.tsx`](../examples/storefront-demo/src/config/SetupScreen.tsx)).
Nothing is baked into the bundle, which is also why one deployed build can serve
several pitches.

Choose `next-server-first` when the *architecture* is the pitch. It carries
i18n under `[lang]`, per-page metadata, canonical and hreflang, JSON-LD and a
sitemap — real substance, but it is a slower start and it needs infrastructure.

## 2 — Run it

```bash
pnpm install
pnpm -r --filter "./packages/*" build   # the examples import from dist/
pnpm -F @viu/emporix-examples-storefront-demo dev
```

The package build is not optional: examples typecheck and run against the built
`dist/` of `@viu/emporix-sdk` and `@viu/emporix-sdk-react`, not their sources.

Then enter the tenant and public storefront client id on the setup screen. Fill
in **currency and country too** — without both in the session context the
price-match returns nothing and every product renders without a price, which
reads as a broken storefront rather than a configuration gap.

## 3 — Give the customer a URL

A deploy already exists. [`.github/workflows/pages.yml`](../.github/workflows/pages.yml)
builds `storefront-demo` and publishes it to GitHub Pages on every push to
`main` that touches `examples/storefront-demo/**` or `packages/**`, and it also
accepts a manual `workflow_dispatch` run:

```
https://viuteam.github.io/emporix-sdk/
```

Because the build carries no tenant binding, that one URL serves any pitch — you
send the link and enter the customer's tenant on the setup screen. For most
pitches that is the whole answer, and there is nothing to build.

**The gate that will actually bite you is CORS on the customer's tenant.** The
browser calls Emporix directly, so the tenant has to allow the
`https://viuteam.github.io` origin (plus OAuth redirect URIs if you use the
login redirect). Arrange that before the meeting, not during it — a blocked
preflight surfaces as an empty catalog with a console error, not as a message
anyone in the room can interpret.

Two limits worth knowing before you promise a URL:

- **`main` only, one URL.** There is no per-branch or per-customer deploy. Two
  pitches in parallel on visibly different skins means either merging both to
  `main` or deploying the second one somewhere else yourself.
- **Sub-path, not root.** `VITE_BASE` is `/emporix-sdk/` and the router reads
  `import.meta.env.BASE_URL`. For a custom domain set `VITE_BASE=/` and add a
  `CNAME` — see the demo's README.

## 4 — Re-skin it

The whole aesthetic is in one file:
[`examples/storefront-demo/src/styles/tokens.css`](../examples/storefront-demo/src/styles/tokens.css)
— palette, two font families, a fluid type scale, spacing, radii, shadows and
easing. `global.css` and `catalog.css` consume those variables and should not
need editing for a colour-and-type change.

A customer skin is realistically: the palette variables, `--font-display` and
`--font-body`, and `--radius`. The fonts are loaded as npm packages
(`@fontsource-variable/*`) rather than from a CDN, so swapping a family means
adding a dependency and changing the import in `main.tsx`.

**Known trap:** `next-server-first` has its own copy of `tokens.css` and the two
have already diverged — 41 declarations there against 38 here, 112 differing
lines as of 2026-08-17. Skinning one does nothing to the other, and neither is
authoritative. If a pitch needs both examples on one brand, budget for doing it
twice or consolidate the file into
[`examples/shared`](../examples/shared) first.

## 5 — Fill the tenant with the customer's catalog

A storefront showing the customer's own products is what makes a pitch land, and
this is the part with no tooling yet — there is no seed script in the repo. The
SDK primitives are there, and a throwaway script belongs next to
[`examples/node-server`](../examples/node-server), which is the reference for
service credentials.

```ts
const results = await client.products.bulkCreate({ /* … */ });
const prices  = await client.prices.bulkCreate([ /* … */ ]);
```

Both default to service auth (`clientCredentials`), so this is server-side work
and needs the backend client id and secret — never the storefront client id.

Three things to get right:

- **207 Multi-Status does not throw.** Both bulk calls return one result entry
  per input and partial failures come back as data. A script that only checks
  for a rejected promise will report success while half the catalog is missing.
  Inspect every entry.
- **A product without a price is not sellable.** Emporix requires a `priceId` on
  internal cart items, so an unpriced product breaks add-to-cart, not just the
  price label. Seed prices in the same run.
- **Not the Import Service.** `client.imports` manages import *configurations*,
  streams and cron schedules — not a CSV push — and upstream marks all 15 of its
  operations as preview. For seeding, the bulk facades above are the shorter
  path. See [`import.md`](./import.md).

Media and category assignment are separate calls again
([`media.md`](./media.md), [`catalog.md`](./catalog.md)). For a pitch, category
placement usually matters and images almost always do — a grid of placeholder
tiles undercuts everything else on the screen.

## 6 — If the pitch converts

Copying an example out of the monorepo does not work as-is: both
`storefront-demo` and `next-server-first` depend on
`@viu/emporix-examples-shared` with `workspace:*`, and that package is
**unpublished**. The three real packages resolve fine against npm once you swap
`workspace:*` for a version range; the shared one has to be vendored.

That is deliberate — [`examples/README.md`](../examples/README.md) says to copy
the files. Do that at handover, not before: pitching from a branch of this
monorepo costs nothing and avoids maintaining a fork that nobody has committed
to yet.

## What this doc does not solve

- **No per-customer deploy.** One Pages URL from `main` (§3).
- **No seed tooling.** The primitives exist; the script does not (§5).
- **One brand at a time across two examples.** The token file is duplicated and
  already drifted (§4).
- **Nothing here is measured against a customer pitch.** Every claim comes from
  the repo as of 2026-08-17: the workflow, the token files, the facade
  signatures, and a `200` from the live Pages URL. The pitch process itself is
  untested against reality — correct this file when it meets one.
