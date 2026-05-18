# Plan B — Price Service Type Bindings

Verified against `packages/sdk/src/generated/price/types.gen.ts` on 2026-05-18.

| Use | Generated symbol |
|---|---|
| Match response item | `MatchResponse` |
| Match request body (explicit context) | `Match` |
| Match-by-context request body | `MatchByContext` |
| Quantity sub-type | `MatchMeasurementUnitV2` |

`matchByContext` returns `MatchResponse[]`; `match` returns `MatchResponse[]`.

Both **request and response** use the generated types (user refinement —
generated types for the full request too, not just the response):

| Public alias | Generated symbol |
|---|---|
| `PriceMatchByContextInput` | `MatchByContext` |
| `PriceMatchInput` | `Match` |
| `PriceMatch` | `MatchResponse` |

`matchByContext(input, auth?)` / `match(input, auth?)` pass the generated
request body through verbatim.
