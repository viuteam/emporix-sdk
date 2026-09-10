# Facade standard

How a wrapped endpoint looks in this repo. Copy the neighbouring method in the
file you are editing before copying anything here — the file you are in is the
most reliable style guide. This is the shape those files share.

## Where things go

| Change | Files |
|---|---|
| New operation on an existing service | `packages/sdk/src/services/<svc>.ts`, `packages/sdk/tests/services/<svc>*.test.ts`, `docs/<svc>.md` |
| New request/response type | `packages/sdk/src/services/<svc>-types.ts` where the service has one, else the facade file |
| Whole new service | the three above **plus** `src/client.ts` (import, `readonly x: XService`, `new XService(mk(XService.channel))`), `src/index.ts` (export), `src/<svc>.ts` (`export * from "./services/<svc>"`), `tsup.config.ts` (entry) |

## The method

```ts
const SERVICE: AuthContext = { kind: "service" };

/**
 * List reindex jobs (paginated).
 *
 * On `BATTERY_INCLUDED` the stored credentials are validated first, so a `400`
 * here can be about the write key rather than the request body.
 */
async listReindexJobs(
  opts: ListReindexJobsOptions = {},
  auth: AuthContext = SERVICE,
): Promise<PaginatedItems<ReindexJob>> {
  const pageNumber = opts.pageNumber ?? 1;
  const pageSize = opts.pageSize ?? 50;
  const query: Record<string, string | number | undefined> = { pageNumber, pageSize };
  if (opts.q !== undefined) query.q = opts.q;
  if (opts.sort !== undefined) query.sort = opts.sort;
  return requestPage<ReindexJob>(
    this.ctx.http,
    { method: "GET", path: `${this.base()}/reindex-jobs`, auth, query },
    { pageNumber, pageSize },
  );
}
```

Load-bearing details:

- **`auth: AuthContext = SERVICE` is the last parameter**, always present, always
  overridable. `AuthContext` is `{ kind: "service" } | { kind: "anonymous" } |
  { kind: "customer"; token }`. Pick the default from the spec's `security`
  scopes: a backend-only scope defaults to `SERVICE`; a storefront-reachable
  endpoint takes the caller's token. The scopes are in the coverage report.
- **Assign a query parameter only when it is defined** (`if (opts.q !==
  undefined)`). Assigning `undefined` unconditionally is how a stray `?q=` gets
  onto the wire; a test asserting `searchParams.get("q") === null` for the unset
  case is what keeps it out.
- **`path` is built from `this.base()`**, and `base()` carries the tenant:
  `` return `/indexing/${this.ctx.tenant}`; ``.
- **`encodeURIComponent` on path segments** in new code. Older methods in the
  same file often lack it — leave them; changing an encoding changes published
  behaviour, so it is its own PR with its own reasoning.
- **Paginated reads** go through `requestPage` + `PaginatedItems`; `totalCount`
  is an SDK-side flag that becomes the `X-Total-Count` request header, so
  destructure it out before spreading the rest into the query string.

## Types come from the generated ones — in both directions

```ts
import type { GetAsset, AssetCreateBlob, PatchOperation } from "../generated/media";

export type Asset = GetAsset;
export type AssetCreateBlobInput = AssetCreateBlob;
/** Partial-update body (`PATCH /assets/{id}`) — an RFC-6902 JSON-Patch op-array. */
export type AssetPatch = PatchOperation[];
```

Alias, do not restate. Inputs matter as much as outputs: a hand-written request
interface drifts from the spec silently, whereas an alias picks up new fields on
the next sync with no facade change at all. That is also why a spec sync can be
valuable with an empty facade diff — and why new fields need documenting, since
nothing else announces them.

Where the wire shape is genuinely open (Emporix `q`-syntax filters), keep the
explicit fields for autocomplete and leave an index signature:

```ts
export interface ListAssetsQuery {
  pageSize?: number;
  /** Emporix `q`-syntax filter, e.g. `"name:hero"`. */
  q?: string;
  [key: string]: string | number | boolean | undefined;
}
```

## JSDoc carries what the types cannot

The signature already says what the arguments are. The JSDoc is for what breaks
callers, and reviewers of this repo look for it:

- which status codes mean what, especially a status that does *not* mean the
  request body was wrong;
- merge-vs-replace semantics (`PATCH` merges, `PUT` needs the whole document,
  `null` stores `null` instead of deleting);
- immutable fields the server validates against the stored value;
- optimistic locking (`metadata.version`, `409`);
- fields that are optional in the type but always present in practice — or the
  reverse, which needs a narrowing example rather than a sentence.

Write the example so it compiles. An `id?: string` in the response type means
`getJob(job.id)` does not typecheck, and a doc example that fails `pnpm
typecheck` is caught at review instead of at authoring, which wastes a round.

## Test

One file per service under `packages/sdk/tests/services/`, MSW for HTTP, a local
`svc()` factory building the service over an `HttpClient` (copy it from the
neighbouring test — it wires `DefaultTokenProvider`, a `MemoryLogger` and the
`oauth/token` handler).

Assert the things a wrapper can get wrong: the **URL**, the **method**, the
forwarded **query parameters including their absence**, headers, and the request
body. One test can cover both halves of a parameter:

```ts
it("listReindexJobs forwards sort, and omits it when unset", async () => {
  const seen: (string | null)[] = [];
  server.use(
    http.get(`https://api.emporix.io/indexing/${TENANT}/reindex-jobs`, ({ request }) => {
      seen.push(new URL(request.url).searchParams.get("sort"));
      return HttpResponse.json([job]);
    }),
  );
  const client = sdk();
  await client.indexing.listReindexJobs({ sort: "metadata.createdAt:desc" });
  await client.indexing.listReindexJobs();
  expect(seen).toEqual(["metadata.createdAt:desc", null]);
});
```

The sdk tsconfig has no DOM lib, so DOM-only types are not available in tests —
`FormDataEntryValue` fails to compile. Type the captured value as `unknown` and
narrow it.

## Docs

`docs/<svc>.md` gets the new method with a runnable example, and the traps in a
table when there are more than two. If the service's doc page only documented a
deprecated predecessor, this is the moment to document the replacement properly
rather than adding one line to a page that misleads.
