# Import Service

Bindings for the Emporix **Import Service** (`/importtool/{tenant}/…`): import
configurations and their streams, cron schedules, run control, and the records an
import produced.

> **Server-side only.** Every operation requires the service
> (clientCredentials) token with the `importtool.import_trigger` scope. There is
> no customer or anonymous variant — see
> [Why there is no React hook](#why-there-is-no-react-hook).

> **Preview.** Upstream marks all 15 operations as preview: the contract may
> change without a major version, and nearly every response field is optional in
> the spec. Treat run counters and statuses as possibly absent.

## Configurations and streams

```ts
const configs = await client.imports.listConfigs();
const config = await client.imports.getConfig("cfg1");

const streams = await client.imports.listStreams("cfg1");
const stream = await client.imports.getStream("str1");
```

A configuration groups one or more streams; a stream extracts from a source, maps
fields and upserts into an Emporix target type. `config.deltaEnabled` tells you
whether incremental runs are possible at all.

## Schedules

```ts
const schedule = await client.imports.getSchedule("cfg1");
if (schedule === null) {
  // no schedule configured — this is a 204, not a 404
}

await client.imports.setSchedule("cfg1", {
  cron: "0 0 3 * * *",        // six-field Spring expression
  timezone: "Europe/Zurich",
  enabled: true,
});

await client.imports.deleteSchedule("cfg1"); // runs only when triggered now
```

`getSchedule` resolves to `null` rather than throwing, because the service
answers an unscheduled configuration with `204 No Content`. An absent schedule is
a normal result, so it should not need a `try`/`catch`.

**`cron` has six fields, not five.** `second minute hour day-of-month month
day-of-week`. The familiar five-field `"0 * * * *"` is not «hourly» here, it is
invalid, and `setSchedule` answers `400`. That is a recent improvement: the
service used to store such an expression and then silently never fire it. A
`404` from `setSchedule` means no configuration with that id, so there is
nothing to schedule.

**`deleteSchedule` is idempotent and does not require the configuration to
exist.** Removing a schedule that is not there resolves just the same, and —
unlike `setSchedule` — the configuration need not still be around. That
asymmetry is deliberate: a schedule left behind by a deleted configuration is
precisely what needs removing, and refusing those would leave them with no way
out. It resolves to `void`, since the service answers `204`.

## Runs

```ts
const run = await client.imports.triggerRun("cfg1", { mode: "FULL" });
// mode defaults to DELTA server-side; dryRun: true maps and validates
// without writing to the target

const runs = await client.imports.listRuns("cfg1", { pageNumber: 1, pageSize: 20 });
const detail = await client.imports.getRun(run.id!);   // { run, streams }
const errors = await client.imports.listRunErrors(run.id!, { pageSize: 100 });

await client.imports.cancelRun(run.id!);                 // cooperative
await client.imports.cancelRun(run.id!, { force: true }); // hard stop
```

`cancelRun` resolves with `accepted: false` when the run is unknown or already
finished — that is a `202`, not an error. A state conflict can instead come back
as a `409`, which throws like any other error status.

`triggerRun` is a POST and is **not** retried on a 5xx: a request that timed out
may already have queued a run.

### Previewing a dry run, and naming who asked

A dry run can hand back what it *would* have written — pass `sampleSize` and
read the run's `dryRunSample`:

```ts
const preview = await client.imports.triggerRun("cfg1", {
  dryRun: true,
  sampleSize: 5,            // per stream, clamped to 1–100, defaults to 25
  origin: "Dashboard",
});

for (const row of preview.dryRunSample ?? []) {
  console.log(row.stream, row.targetType, row.key, row.fields);
}
```

`dryRunSample` is absent on a normal run.

`origin` names **what** asked for the run. It exists because `trigger` only
records `MANUAL` or `SCHEDULED`, so without it a dashboard click, an integration
scenario and your own scheduler are indistinguishable in the run history. Omit
it or send a blank value and the service stores the `trigger` value instead.

> Over 40 characters, or containing control characters, is **rejected — not
> shortened**. A truncated label in an audit trail is worse than a refused
> request, so keep `origin` short and stable.

The run also carries two counters that describe the **source feed** rather than
the import: `duplicateKeys` (source rows repeating a key already imported in the
run — only the last survives, so differing repeats lose data) and
`unresolvedParents` (child records whose parent was not found, distinct from
`skipped`, which means already up to date). A run can report `SUCCEEDED` with
both non-zero, which is exactly why they are worth reading — the loss is
invisible in the pass/fail counters. `stats()` carries the same picture per
stream in its `sourceIssues` array.

> `sections` is a **comma-separated string**, and its documented values are
> `TOTALS`, `STREAMS`, `ERRORS`, `CHANGES` — `sourceIssues` is not among them.
> Whether it is gated by one of those or always returned is not stated in the
> spec, so read it defensively (`stats.sourceIssues ?? []`) and pass no
> `sections` if you need it.

## Streaming a run

```ts
for await (const ev of client.imports.streamRun(runId)) {
  switch (ev.type) {
    case "snapshot":
      console.log(ev.run?.status, ev.streams.length);
      break;
    case "stream":
      console.log(ev.stream.streamName, ev.stream.recordsRead);
      break;
    case "run":
      console.log("finished:", ev.run.status);
      break;
    case "unknown":
      console.warn("unmodelled event", ev.event, ev.data);
      break;
  }
}
```

The service sends an initial `snapshot`, a `stream` event per processed batch,
and a final `run` event when the run finishes. `streamRun` maps each frame onto a
discriminated union; `ev.streams` is always an array, never `undefined`.

The fourth arm exists because the service is in preview. A new event name, an
unparseable payload or a payload that is not a JSON object arrives as
`{ type: "unknown", event, data }` instead of throwing — one bad frame must not
abort a run you are watching, and must not disappear silently either.

Two properties inherited from the SDK's SSE transport:

- **No re-auth.** A `401` while opening the stream throws instead of minting a
  fresh token and retrying once. A long-lived consumer should be ready to
  re-open, or fall back to polling `getRun`.
- **No read budget.** Only time-to-headers is bounded. Breaking out of the
  `for await` aborts the underlying request.

## Imported records

```ts
const types = await client.imports.listDataTypes();

const page = await client.imports.searchRecords({
  type: types[0]!,
  search: "SKU-",          // substring match on the natural key only
  outcome: "UPSERTED",
  pageSize: 100,
});

const byStream = await client.imports.searchStreamRecords("str1", { outcome: "FAILED" });
```

`search` is **not** the Emporix query language — no field selectors, no
comparisons, no boolean logic. It is a case-insensitive substring match on the
record's natural key.

Mind one upstream asymmetry: the `outcome` **filter** is a closed enum
(`UPSERTED`, `DELETED`, `DELETED_TARGET`, `FAILED`, `DRY_RUN`), but
`ImportedRecord.outcome` is a free string in the spec and its documented example
value (`UPDATED`) is not in that enum. Give any `switch` over a record's
`outcome` a default branch.

## Analytics and retrying failures

Added upstream on 2026-08-26, all on the same `importtool.import_trigger` scope as
the rest of this surface.

```ts
// Aggregated analytics. `sections` decides what the service computes, so name
// what you render — asking for everything on a long history is the expensive call.
const stats = await client.imports.stats({ configId: "cfg1", granularity: "DAY" });

// The dashboard view: configurations with their runs grouped under them.
const groups = await client.imports.listJobGroups();

// The error rates above which a stream counts as degraded or failing in `stats`.
const thresholds = await client.imports.getHealthThresholds();

// Limits and current consumption.
const license = await client.imports.getLicense();
```

**A retry is a new run, not a mutation of the old one.**

```ts
const retried = await client.imports.retryRun(failed.id!);
// retried.id !== failed.id, and retried.retry === true
for await (const ev of client.imports.streamRun(retried.id!)) {
  // follow it exactly as you would a triggered run
}
```

`retryRun` re-processes only the records that failed. Like `triggerRun` it is
**not** retried on a 5xx: a POST that timed out may already have queued the retry.

Reading the thresholds is all this service covers — changing them needs
`importtool.import_manage`, which is outside the scope this surface is built on.

## Pagination

`listRuns`, `listRunErrors`, `searchRecords` and `searchStreamRecords` return
`ImportPage<T>` — the usual [`PaginatedItems<T>`](./pagination.md) plus the
totals this API reports:

```ts
type ImportPage<T> = PaginatedItems<T> & { totalElements: number; totalPages: number };
```

Two things are specific to this service:

- **`hasNextPage` is exact here.** Everywhere else in the SDK it is a guess
  (`items.length === pageSize`); this API reports `totalPages`, so a full page
  that happens to be the last one is correctly reported as `hasNextPage: false`.
- **`pageNumber` / `pageSize` echo what the service used**, not what you asked
  for. It clamps `size`, and reporting the requested value would misdescribe the
  page you actually received.

The facade is one-based like the rest of the SDK and sends `page = pageNumber - 1`
on the wire. An `ImportPage` is assignable to `PaginatedItems`, so `iterateAll`
consumes it unchanged:

```ts
import { iterateAll } from "@viu/emporix-sdk";

for await (const err of iterateAll((pageNumber) =>
  client.imports.listRunErrors(runId, { pageNumber, pageSize: 100 }),
)) {
  // every error of the run
}
```

## Using it from Next.js

There is no separate binding in `@viu/emporix-sdk-next` — a service client needs
no per-service registration. Build one with the credential set that carries the
import scope and call `client.imports` on it:

```ts
// lib/emporix-service.ts
import { getEmporixServiceClient } from "@viu/emporix-sdk-next/service";

export const service = getEmporixServiceClient({
  credentials: {
    importer: {
      clientId: process.env.EMPORIX_IMPORTER_ID!,
      secret: process.env.EMPORIX_IMPORTER_SECRET!,
      scope: "importtool.import_trigger",
    },
  },
});
```

`emporixTags` has nothing to add either: cache tags cover catalog reads
(product, category, price, availability, site), and an import run is not a
cacheable read. Re-validate the catalog tags after a run that wrote products.

A Route Handler that re-emits the run stream to the browser is in the
[next package README](../packages/next/README.md#streaming-an-import-run-to-the-browser).

## Why there is no React hook

`@viu/emporix-sdk-react` ships no hooks for this service, and that is a decision
rather than a gap. Every operation needs client-credentials with the
`importtool.import_trigger` scope; `EmporixProvider` is configured with a public
storefront client id. A hook would therefore require a secret in the browser
bundle, which is the one thing the package must not make easy.

The supported path is a server route: a Next Route Handler or Server Action using
the `/service` entry above, with your own authorisation in front of it. The
browser talks to your route, never to Emporix.

## What is not verified against a live tenant

The URLs, methods, query parameters, request bodies and auth kind are pinned by
unit tests. The **response shapes** are taken from the spec and have not been seen
on the wire: the operations need a service account with the
`importtool.import_trigger` scope, this repo has no such credentials, and every
endpoint is preview. If a field arrives differently than typed here, the spec was
the thing that was wrong — open an issue with the observed payload.

Three behaviours on this page come from the spec's prose rather than from an
observation, and are worth confirming the first time you exercise them against a
real tenant: that `deleteSchedule` really does accept a configuration that no
longer exists, that `origin` is refused rather than truncated past 40
characters, and which `sections` value (if any) gates `sourceIssues`.

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set).
