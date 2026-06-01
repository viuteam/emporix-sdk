# Webhook Service

Bindings for the Emporix **Webhook Service** (`/webhook/{tenant}/…`): the
event-subscription catalog, delivery configurations, statistics, and Svix
dashboard access.

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
