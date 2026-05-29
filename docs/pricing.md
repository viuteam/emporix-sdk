# Pricing

`client.prices.matchByContext(input, auth?)` resolves prices for `input.items`
against the session context (currency/site/country bound to the token).

## Large carts — chunking

The Emporix `match-prices-by-context` endpoint handles only a limited number of
items per request (in production, > ~50 items per request leads to 4xx errors,
timeouts, or partial responses). Use `matchByContextChunked` so the SDK splits
the request for you — the recommended (and default) `chunkSize` is 50.

```ts
const prices = await client.prices.matchByContextChunked(
  { items },                         // any number of items
  { chunkSize: 50, concurrency: 4 }, // defaults shown
);
```

By default, if a chunk fails the others are still returned and `onChunkError`
is invoked for the failed chunk:

```ts
await client.prices.matchByContextChunked(input, {
  onChunkError: (err, chunkIndex) => report(err, chunkIndex),
});
```

Pass `throwOnAnyChunkError: true` to reject on the first failed chunk instead.

**Result order is not guaranteed** across chunks — match entries back to your
items by `priceId` / `itemRef.id`, never by position.

## React

```tsx
import { useMatchPricesChunked } from "@viu/emporix-sdk-react";

const { data: prices } = useMatchPricesChunked({ items }, { chunkSize: 50 });
```

The existing `useMatchPrices` is unchanged; use it for small carts that fit a
single request.
