# Webhook Service

Bindings for the Emporix **Webhook Service** (`/webhook/{tenant}/…`): the
event-subscription catalog, delivery configurations and their delivery status,
failed messages and the jobs that restart them, statistics, and Svix dashboard
access.

> **Server-side only.** Every endpoint requires the backend
> `webhook.subscription_read` / `webhook.subscription_manage` scopes, served by
> the **service (clientCredentials) token**. Never construct these calls from a
> browser — the admin token must not be exposed. Use them in Node, Next.js route
> handlers / server actions, or other trusted backends.

## Event subscriptions — `client.webhooks`

```ts
// list the catalog (each event's on/off state + excluded fields)
const subs = await client.webhooks.listEventSubscriptions();

// batch subscribe/unsubscribe — returns a per-item result (HTTP 207)
const results = await client.webhooks.updateEventSubscriptions([
  { eventType: "product.created", action: "SUBSCRIBE" },
  { eventType: "order.created", action: "UNSUBSCRIBE" },
]);

// 207 is success at the HTTP level. The batch can partially fail —
// inspect each item rather than relying on a thrown error:
const failed = results.filter((r) => (r.code ?? 0) >= 400);
if (failed.length) {
  console.warn("some subscriptions failed", failed);
}
```

`metadata.version` on an update item provides optimistic locking; a stale
version surfaces as a per-item failure in the 207 result.

## Delivery configurations

Only **one** configuration may be `active: true` at a time.

```ts
const configs = await client.webhooks.listConfigs();
const cfg = await client.webhooks.getConfig("my-hooks");

// create (returns { code }; the body carries the code you choose)
const { code } = await client.webhooks.createConfig({
  code: "my-hooks",
  active: true,
  provider: "HTTP",
  configuration: { destinationUrl: "https://example.com/hooks", secretKey: "whsec_…" },
});

await client.webhooks.replaceConfig(code, {
  code,
  active: true,
  provider: "SVIX_SHARED",
  configuration: {},
});

// PATCH takes an array of { op, path, value } operations (UPSERT / REMOVE)
await client.webhooks.patchConfig(code, [{ op: "UPSERT", path: "/active", value: false }]);

// deleting the *active* config requires force
await client.webhooks.deleteConfig(code);                  // non-active
await client.webhooks.deleteConfig("cfg_active", { force: true }); // active
```

`secretKey` is **write-only**: `getConfig` never returns it, only
`secretKeyExists: boolean`. Re-send `secretKey` only when rotating it.

### Delivery status

`{ expand: "deliveryStatus" }` adds the health of every delivery target: the
config's own target and each `eventsConfiguration` entry.

```ts
const cfg = await client.webhooks.getConfig("my-hooks", { expand: "deliveryStatus" });
const failing = (cfg.configuration?.eventsConfiguration ?? []).filter(
  (entry) => entry.deliveryStatus?.status === "FAILING",
);
// consecutiveFailures, lastErrorStatusCode, lastErrorMessage, failingSince
```

The calls without options, `listConfigs(auth)` and `getConfig(code, auth)`,
still work.

## Failed messages

When a target fails too many times in a row (100 by default; the
Configuration Service key `webhookFailureThreshold` takes 10 to 1000), the
service switches it off and stores its events instead of delivering them. Stored
events are kept for 14 days on production and 1 day on preprod.

```ts
// newest failure first; the list never carries `payload`
const page = await client.webhooks.listFailedMessages({ configCode: "my-hooks", pageSize: 100 });

// the payload comes with the single read
const first = page.items[0];
if (first?.id) {
  const msg = await client.webhooks.getFailedMessage(first.id);
  console.log(msg.payload);
}

// page by cursor: pass the cursor back, and keep the same sort
if (page.nextCursor) {
  await client.webhooks.listFailedMessages({ configCode: "my-hooks", next: page.nextCursor });
}
```

Resending needs the target active again. Switch the config or entry back on
first, then resend one message or restart a selection as a job:

```ts
await client.webhooks.patchConfig("my-hooks", [{ op: "UPSERT", path: "/active", value: true }]);

await client.webhooks.resendFailedMessage(messageId); // 202, delivered after the response

const job = await client.webhooks.restartFailedMessages({ configCode: "my-hooks" });
if (job.id) {
  const progress = await client.webhooks.getJob(job.id); // in_progress | success | failure
}

// give up on them instead
await client.webhooks.deleteFailedMessages({ configCode: "my-hooks", eventType: "product.created" });
```

| Trap | What to do |
|---|---|
| `restartFailedMessages({})` and `deleteFailedMessages({})` select **every** stored message | Both take the selection without a default, so an empty one is always written out. Narrow it with `configCode`, `entryId`, `eventType`, `targetType` or `ids` (up to 100) |
| `resendFailedMessage` answers `EmporixConflictError` (409) | The config or entry is gone, inactive, on another provider, or no longer delivers the event type. Activate it first |
| A second restart answers `EmporixConflictError` (409) | One restart job per tenant at a time. Wait for the running one with `getJob` |
| A restart leaves some messages stored | It skips what it cannot resend and covers only messages stored before it started. Check `skipped` on the job |
| `next` and `prev` together answer 400; a cursor page has no `totalCount` | Send one cursor, with the `sort` of the request that returned it. The SDK leaves `pageNumber` out in cursor mode |

## Jobs

```ts
const jobs = await client.webhooks.listJobs({ pageSize: 20 }); // newest first
for (const job of jobs.items) {
  console.log(job.type, job.status, job.republished, job.skipped);
}
```

## Statistics & dashboard

```ts
const stats = await client.webhooks.getStatistics({ fromYearMonth: "2026-01", toYearMonth: "2026-03" });
const access = await client.webhooks.getDashboardAccess();
```

Statistics is oriented around the shared Svix provider (`SVIX_SHARED`).

## Overriding the token

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set). Pass `auth.service("other-set")` to use a different
configured credential set, or `auth.raw(token)` for a pre-obtained token.
