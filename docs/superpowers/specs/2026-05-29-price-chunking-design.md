# PriceService.matchByContextChunked — Design

**Date:** 2026-05-29
**Status:** Approved (pending written-spec review)
**Packages:** `@viu/emporix-sdk` (core), `@viu/emporix-sdk-react` (hook)
**Branch:** `feat/price-chunking` (off `main`)

## Goal

Move the client-side chunking of large price-match requests into the SDK:
`matchByContextChunked` splits `items` into batches, calls `matchByContext` with
bounded concurrency, and aggregates the results — so consumers stop hand-chunking
at 50.

## Background — verified against the Emporix API

- Endpoint: `POST /price/{tenant}/match-prices-by-context` (price.yml:747).
- The request body (`MatchByContext`) has a single array field, **`items`**, each
  `{ itemId: { itemType, id }, quantity }`. The requirement text said `itemRefs`;
  that is **wrong for the request**. `itemRef` appears only in the **response**
  (`MatchResponse.itemRef.{itemType,id}`), which is what consumers use to match
  results back. So chunking splits **`input.items`**.
- Response: `MatchResponse[]` (the SDK's `PriceMatch[]`), one entry per matched
  item, carrying `priceId` and `itemRef.id`.
- No formal per-request item cap is documented, but production shows `> 50` items
  per request causing 4xx/timeouts/partial responses — hence default chunk size 50,
  the value consumers already use.

## Public API — `packages/sdk/src/services/price.ts`

```ts
export interface MatchByContextChunkedOptions {
  /** Items per request. Default 50. Must be >= 1. */
  chunkSize?: number;
  /** Max in-flight requests. Default 4. Must be >= 1. */
  concurrency?: number;
  /** Called once per failed chunk (default mode only). */
  onChunkError?: (err: unknown, chunkIndex: number) => void;
  /** When true, the first chunk failure rejects the whole call. Default false. */
  throwOnAnyChunkError?: boolean;
}

async matchByContextChunked(
  input: PriceMatchByContextInput,
  opts?: MatchByContextChunkedOptions,
  auth?: AuthContext,
): Promise<PriceMatch[]>;
```

### Behaviour

- **Defaults:** `chunkSize = opts.chunkSize ?? 50`, `concurrency = opts.concurrency ?? 4`.
- **Validation:** throw `new Error("chunkSize must be >= 1")` / `"concurrency must be >= 1"`
  when out of range (plain `Error`, consistent with `getByCode`).
- **Empty input:** `(input.items ?? []).length === 0` → resolve `[]` with no HTTP call.
- **Chunking:** split `input.items` into slices of `chunkSize`; each chunk is sent as
  `{ ...input, items: slice }` through the existing `matchByContext(chunkInput, auth)`
  (so the context/token semantics are unchanged, and any future input fields are
  preserved by the spread).
- **Concurrency pool:** spawn `min(concurrency, chunkCount)` workers that pull the
  next chunk index from a shared cursor and `await matchByContext`. This guarantees
  no more than `concurrency` requests are ever in flight.
- **Error handling:**
  - default (`throwOnAnyChunkError` falsy): a chunk that rejects contributes no
    items and triggers `onChunkError(err, chunkIndex)` exactly once; all other
    chunks still resolve and are returned.
  - `throwOnAnyChunkError: true`: the first chunk rejection propagates and rejects
    the whole call (other in-flight requests are not awaited further).
- **Aggregation:** the per-chunk arrays are concatenated. **Order is not
  guaranteed** — documented; consumers match results by `priceId` / `itemRef.id`.
- Returns the existing `PriceMatch` type. No new client wiring (PriceService is
  already on `EmporixClient`); no new subpath export.

## React — `packages/react/src/hooks/use-match-prices-chunked.ts`

A **new** hook (the existing `useMatchPrices` is untouched — no API break),
mirroring `useMatchPrices`'s style (anonymous/`customerToken`, `useReadSite`):

```ts
export function useMatchPricesChunked(
  input: PriceMatchByContextInput,
  options?: {
    enabled?: boolean;
    customerToken?: string | null;
    chunkSize?: number;
    concurrency?: number;
  },
): UseQueryResult<PriceMatch[]>;
```

- Auth: `customerToken` → `auth.customer`, else `auth.anonymous()`.
- Query key: `["emporix", "match-prices-chunked", { tenant, input, anon, siteCode, chunkSize, concurrency }]`.
- `enabled`: `(options.enabled ?? true) && (input.items?.length ?? 0) > 0`.
- `queryFn`: `client.prices.matchByContextChunked(input, <opts>, ctx)`, passing only
  the defined `chunkSize` / `concurrency` (conditional spread to satisfy
  `exactOptionalPropertyTypes`).
- `staleTime: 60_000` (same as `useMatchPrices`).
- `onChunkError` / `throwOnAnyChunkError` are SDK-level only — not exposed on the
  hook (callbacks in render are awkward; the hook wants partial results for the UI).
- Registered in `packages/react/src/hooks/index.ts` and the package barrel.

## Tests

### SDK — `packages/sdk/tests/services/price.test.ts` (Vitest + MSW)

The existing file already mocks the anonymous-login + `match-prices-by-context`
endpoint. New `describe("PriceService.matchByContextChunked")` cases:

- **150 items, chunkSize 50** → exactly **3** POSTs; every item id present in the
  aggregated result. (MSW echoes one `MatchResponse` per received item, using
  `itemRef.id`.)
- **chunkSize 1, 5 items** → exactly **5** POSTs.
- **one chunk returns 500** → the other chunks' results are still returned, and
  `onChunkError` is called exactly once.
- **`throwOnAnyChunkError: true`** with a failing chunk → the call rejects.
- **concurrency limit** → with `concurrency: 2` and delayed responses, the MSW
  handler tracks the number of simultaneously in-flight requests and asserts the
  peak never exceeds 2.
- **validation** → `chunkSize: 0` and `concurrency: 0` each reject/throw.

### React — `packages/react/tests/use-match-prices-chunked.test.tsx`

Mirror `use-match-prices.test.tsx`: render with an `items` array spanning multiple
chunks, assert the aggregated `data` length and that the hook is disabled on empty
items.

## Docs — `docs/pricing.md`

Create. Explain the (informal) server limit on `match-prices-by-context`, recommend
the default `chunkSize` 50, show `matchByContextChunked` + `useMatchPricesChunked`
examples, and stress that result order is not guaranteed — match by
`priceId` / `itemRef.id`.

## Changeset

`.changeset/price-chunking.md` — both packages at **minor**:

```md
---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add PriceService.matchByContextChunked and the useMatchPricesChunked React hook:
split large match-prices-by-context requests into bounded-concurrency chunks
(default 50 items, 4 in flight) with per-chunk error handling.
```

**Changeset-config prerequisite:** `main` lacks the
`___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH.onlyUpdatePeerDependentsWhenOutOfRange: true`
flag (it lives on unmerged feature branches). Without it the `workspace:^` peer
relationship force-**major**s both packages via `linked`. Add the same flag to
`.changeset/config.json` so both bump `2.0.0 → 2.1.0` minor. Verify with
`pnpm changeset status`. Trivial no-op if another branch merges it first.

## Out of scope (YAGNI)

- Chunking the other `match()` method (full-context `Match`); the requirement
  targets `matchByContext`.
- Retrying failed chunks (caller decides via `onChunkError` / re-call).
- Guaranteeing result order (explicitly not promised).
- Deduplicating items across chunks.
