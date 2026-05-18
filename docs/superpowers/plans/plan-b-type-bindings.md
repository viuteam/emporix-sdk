# Plan B — Price Service Type Bindings

Verified against `packages/sdk/src/generated/price/types.gen.ts` on 2026-05-18.

| Use | Generated symbol |
|---|---|
| Match response item | `MatchResponse` |
| Match request body (explicit context) | `Match` |
| Match-by-context request body | `MatchByContext` |
| Quantity sub-type | `MatchMeasurementUnitV2` |

`matchByContext` returns `MatchResponse[]`; `match` returns `MatchResponse[]`.

The facade uses a hand-written idiomatic input type (`PriceMatchItem` /
`PriceMatchInput`) per the spec ("idiomatic inputs allowed; return type is
always the generated type"). Only the return type is the generated symbol
(`MatchResponse`).
