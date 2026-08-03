# Shared example helpers

**Not a demo, and not published.** A helper set that
[`storefront-demo`](../storefront-demo) and
[`next-server-first`](../next-server-first) both need, extracted so the two
cannot drift apart.

## Why it exists

The functions here normalize **Emporix's** read shapes, not any one demo's view
model. Three concrete divergences, all met while building the demos:

- **Orders come back in two forms.** The list endpoint returns `items` with
  `totalPrice: { amount, currency }` and a top-level `orderNumber`. Getting one
  by id returns `entries`, `totalPrice: <number>` with `currency` alongside, and
  `orderNumber` under `mixins.generalAttributes`. `orderVM` / `orderItems` read
  both.
- **Cart lines want their price row echoed back.** A `PUT` replaces the line, so
  an update has to re-send `itemYrn` and the whole `price` object. `toCartLine`
  keeps them. (A quantity-only change avoids this with `{ partial: true }`.)
- **Text fields are sometimes a string and sometimes a locale map.** Across
  tenants and versions, both shapes appear for `name` and `description`.
  `pickText` handles both — and does not treat a bare string as a char map.

Solve these once, not twice.

## Building your own storefront? Copy these files.

They are deliberately **not** part of `@viu/emporix-sdk`. The same reasoning
applies as to
[`next-server-first/app/session-store.ts`](../next-server-first/app/session-store.ts),
which also says «copy it»: a demo helper that becomes public API is API you have
to keep forever.

`src/adapters.ts` and `src/format.ts` have no dependency beyond
`@viu/emporix-sdk` types. Paste them into your project and change what you need.

## What is not here

`sanitizeHtml` stayed in `storefront-demo`. It uses `DOMParser`, which does not
exist in Node — a server-rendered consumer would silently fall through to the
tag-stripping path while believing it had a sanitizer. Server-side callers use
`stripHtml` from here and get plain text, which is at least honest.

## Conventions

No build step: `exports` points at `src/`, and consumers typecheck against the
source. No tests either — `test` and `lint` are no-ops, like the other examples.
It is covered by the two demos typechecking, building and running.
