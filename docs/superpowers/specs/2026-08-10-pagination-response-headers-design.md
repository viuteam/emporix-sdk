# Response headers for pagination: cursors and absolute totals

**Status:** design, approved 2026-08-10. Not yet implemented.
**Date:** 2026-08-10
**Affects:** `packages/sdk/src/core/{http,context}.ts`, a new `core/paged.ts`, the 23
paginated facade methods across 10 services, `packages/react`, `docs/pagination.md`
**Origin:** [PR #250](https://github.com/viuteam/emporix-sdk/pull/250) added cursor
pagination to two schema endpoints. Nothing could consume it, because the SDK cannot
read a response header.

## The problem

Emporix answers list endpoints with metadata the SDK throws away. Two kinds:

- `X-Total-Count` — the absolute number of matches, opt-in per request. Available on
  85 generated endpoints across 22 services.
- `X-Next-Cursor` / `X-Prev-Cursor` — opaque cursors for stable pagination through a
  large collection. New in #250, on `GET /schema/{tenant}/custom-entities/{type}/instances`
  and `POST …/instances/search`.

`HttpClient.request<T>()` returns the parsed body and nothing else, so a facade has no
way to reach either. `docs/pagination.md` already parked the consequence:

> Emporix returns `X-Total-Count` headers on some endpoints, but the SDK does not
> currently expose response headers to facades.

`requestRaw()` does return the `Response`, but it deliberately skips retry-on-5xx and
the 401-reauth-once path — a facade using it would have to re-implement parsing and
error handling to get a header.

### What is already true today

`ListInstancesQuery` carries `[key: string]: string | number | undefined`, and
`listInstances` spreads `...query` into the query string. So `next` and `prev` already
reach the wire — undocumented, invisible at the call site, and useless, because the
cursor value they need can only be read from a response header.

`searchInstances` forwards **no** query parameters at all and returns a hard-coded
`hasNextPage: false`, although the spec allows `pageNumber`, `pageSize`, `sort`, `next`
and `prev` on that endpoint. A pre-existing gap that #250 makes load-bearing.

## Measured before designing

| | count |
|---|---|
| facade methods returning `PaginatedItems` | **23**, across 10 services |
| generated endpoints accepting the `X-Total-Count` request header | 85, across 22 services |
| React files touching `PaginatedItems` | 6 |
| endpoints offering cursors | 2 (both in the schema service) |

Two facts shape the design:

**`X-Total-Count` is a request header, not a query parameter.** The generated types put
it under `headers?: { 'X-Total-Count'?: boolean }`. So asking for totals is an opt-in
per call, and it must be, because the count costs the server a second query — turning it
on for every list the SDK issues would be a silent tax on every storefront.

**The 23 call sites are near-identical.** Each is a variation of:

```ts
const pageNumber = query.pageNumber ?? 1;
const pageSize = query.pageSize ?? 60;
const items = await this.ctx.http.request<T[]>({ … });
return { items, pageNumber, pageSize, hasNextPage: items.length === pageSize };
```

Only the `pageSize` default (50 or 60) and the query shape vary. Header reading added
to each of them separately would be the same three lines 23 times, and the 24th facade
would forget them.

## Design

Three stacked PRs. Each is independently reviewable and revertable; B and C both depend
on A and are independent of each other.

### PR A — the core

**`core/http.ts`.** The existing retry/reauth loop moves verbatim into a private
`send<T>()` whose `res.ok` branch returns the headers alongside the body:

```ts
export interface HttpResult<T> {
  data: T;
  headers: Headers;
}

async request<T = unknown>(o: RequestOptions): Promise<T> {
  return (await this.send<T>(o)).data;
}

async requestWithMeta<T = unknown>(o: RequestOptions): Promise<HttpResult<T>> {
  return this.send<T>(o);
}
```

`request` keeps its signature and its behaviour exactly. No existing facade changes in
this PR. `HttpClient` is exported from `index.ts`, so `requestWithMeta` and `HttpResult`
are public API — changeset `minor`.

Handing back `Headers` rather than the whole `Response` is deliberate: by the time
`send` returns, the body has been consumed, and a `Response` whose body cannot be read
again is a trap in the hands of a caller.

**`core/paged.ts`, new.** One internal helper that owns the whole paginated shape:

```ts
export async function requestPage<T>(
  http: HttpClient,
  o: RequestOptions,
  page: { pageNumber: number; pageSize: number; totalCount?: boolean },
): Promise<PaginatedItems<T>>
```

It sets the `X-Total-Count: true` request header when `page.totalCount` is set, calls
`requestWithMeta`, reads `X-Total-Count`, `X-Next-Cursor` and `X-Prev-Cursor`, and
assembles the result. Cursors travel the other way as ordinary query parameters, so
`next` / `prev` stay in the caller's `o.query` — the helper reads cursors out of the
response and never puts them into the request.

Not exported from `index.ts`. There is no external consumer, and an internal helper can
change shape without a major bump. Exporting it later — as `iterateAll` is exported —
stays available.

**`hasNextPage` gains three precision tiers**, evaluated in order:

1. `X-Next-Cursor` present → `true`. Exact: the spec returns it only when a next page
   exists.
2. otherwise `totalCount` known → `pageNumber * pageSize < totalCount`. Exact.
3. otherwise `items.length === pageSize`. Today's guess, unchanged.

Tier 1 is deliberately **one-directional**. An absent cursor header does not mean "no
next page" — only two endpoints in the whole API emit the header at all, so absence
carries no information and must fall through to tiers 2 and 3.

The two mechanisms do not stack: in cursor mode the server ignores the `X-Total-Count`
request header and omits the response header, so `totalCount` is simply `undefined`
there. The helper needs no special case for this — the header is absent, so the field is
absent.

**`docs/pagination.md`.** The "Why not absolute totals?" section states a limitation
that PR A removes — response headers become readable the moment A lands. It is corrected
in PR A so the docs are never wrong on `main`, and says totals are readable but not yet
surfaced on any facade. The "X of Y" usage section arrives in PR C, when there is
something to document.

### PR B — schema cursors and the iterator

`ListInstancesQuery` gains explicit `next?: string` and `prev?: string`. They already
pass through the index signature; declaring them makes them visible at the call site and
documents where the value comes from.

`searchInstances` gains a `query` argument (`pageNumber`, `pageSize`, `sort`, `next`,
`prev`) and a real `hasNextPage` via `requestPage`. Without this the search endpoint
cannot receive a cursor at all.

`listAllInstances(type, query, auth): AsyncIterable<CustomInstance<T>>` is new. It does
**not** use `iterateAll`: that helper drives pagination by page number, and the server
ignores `pageNumber` once a cursor is in play. The iterator follows `nextCursor` while
the server offers one and falls back to `pageNumber + 1` when it does not.

The fallback is not defensive padding. Whether `GET …/instances` emits `X-Next-Cursor`
on a request that carries no `next` — the bootstrap into cursor mode — is a property of
the tenant's deployment that this design does not assume. With the fallback the iterator
is correct either way, and the measurement becomes a verification step rather than a
blocker.

### PR C — totals across the repo

`PaginatedItems<T>` gains `totalCount?: number`. Optional, so nothing breaks; `ImportPage`
is the precedent for extending this contract rather than forking it.

The remaining 21 methods move to `requestPage`, which replaces their four duplicated
lines — schema's `listInstances` and `searchInstances` already moved in PR B, because
cursors forced them to. Each paginated query interface gains `totalCount?: boolean`.

React needs no structural change: the hooks pass `PaginatedItems` straight through, and
`emporixKey` folds the call arguments into the query key, so `totalCount: true` produces
its own key and cannot be served a cached page that lacks totals. That last point is
checked during implementation rather than assumed.

## Testing

| what | where |
|---|---|
| `requestWithMeta` returns headers; `request` is unchanged | `tests/core/http-headers.test.ts` |
| the three `hasNextPage` tiers, header parsing, absent headers | `tests/core/paged.test.ts`, new |
| cursor params reach the wire; search forwards its query; the iterator follows cursors and falls back | `tests/services/schema.test.ts` |
| the `X-Total-Count: true` opt-in actually reaches the wire | one representative facade test |

All of the header logic lives in `paged.ts`, so one test file covers it for all 23 call
sites. Per-service tests would restate the same assertions ten times.

## Deliberately not in scope

**No local guard that `next` and `prev` are mutually exclusive.** The server answers
`400` and the SDK surfaces it as `EmporixBadRequestError`. A second copy of the rule in
the client is a second place to maintain it, and it would drift the day the server
relaxes the constraint.

**`requestPage` stays internal.** No consumer outside the SDK needs it yet.

**Cursors stay on the two schema endpoints.** No other vendored spec offers them.

**Totals stay opt-in.** Defaulting them on would add a count query to every list call in
every storefront.

## Consequences

`docs/pagination.md` loses its "Why not absolute totals?" limitation and gains an
"X of Y" section. `hasNextPage` becomes exact wherever the caller asks for totals or the
server offers a cursor, and stays a guess elsewhere — a fetch that used to return an
empty trailing page can now be skipped, but only when the caller opts in.

The one behaviour that changes without an opt-in is `searchInstances`: it stops claiming
`hasNextPage: false` unconditionally. That claim was wrong, so this is a fix, but it is a
fix a consumer can observe.
