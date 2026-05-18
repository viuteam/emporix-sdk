# Logging

The SDK emits structured, level-aware logs through a swappable `Logger`. Zero
runtime dependency; safe by default (secrets are redacted); per-service control.

## Levels

`trace < debug < info < warn < error < silent` (numeric `10 < 20 < 30 < 40 < 50 < 60`).
A logger at `info` emits `info`, `warn`, `error`.

- **trace** — request/response bodies (redacted), retry decisions, token cache
  hits/misses, pagination progression, `AuthContext` kind per call
- **debug** — HTTP method+URL+status+duration, token refreshes, auth-context
  resolution (kind only)
- **info** — client construction summary, write-op entry, first auth per scope
- **warn** — retryable failures, rate-limit hits, missing-required-auth, fallbacks
- **error** — non-retryable failures, exhausted retries, config errors

## Per-service resolution chain

For each service (`customer`, `product`, `category`, `cart`, `http`, `auth`),
highest priority first:

```
EMPORIX_LOG_LEVEL_<SERVICE>   (env, per-service)
  ?? EMPORIX_LOG_LEVEL        (env, global)
  ?? config.logger.services[service]
  ?? config.logger.level
  ?? "warn"
```

```bash
EMPORIX_LOG_LEVEL=warn                 # everything at warn
EMPORIX_LOG_LEVEL_CART=trace           # cart at trace, rest unchanged
EMPORIX_LOG_LEVEL_HTTP=debug EMPORIX_LOG_LEVEL_AUTH=debug   # wire + token only
EMPORIX_LOG_LEVEL=silent EMPORIX_LOG_LEVEL_CUSTOMER=info    # only customer
```

Invalid env values are ignored with a single warn; the SDK never throws on bad
env config.

## Configuration

```ts
new EmporixClient({
  // ...
  logger: { level: "info", services: { cart: "debug", customer: "trace" } },
});
// logger: false           → noop logger
// logger: myLoggerObject  → bring your own Logger implementation
```

## Runtime control

```ts
sdk.setLogLevel("debug");                       // global floor
sdk.setLogLevel("trace", { service: "cart" });  // one service
sdk.getLogLevel("cart");                        // effective level
```

Env-set levels are sticky: `setLogLevel` for an env-controlled service warns and
does nothing unless `{ force: true }`.

## Redaction (mandatory, non-reducible)

Default redacted keys (case-insensitive, deep, arrays): `authorization`,
`password`, `oldPassword`, `newPassword`, `clientSecret`, `secret`,
`access_token`, `refresh_token`, `customerToken`, `saasToken`, `bearerToken`,
`apiKey`, `token`. `Authorization` headers log as `Bearer ***redacted***`;
`AuthContext` logs as `{ kind }` only. Extend with `logger.redact: [...]` — the
default set is the floor and cannot be reduced.

## Adapter recipes (documented, not shipped)

### pino

```ts
import pino from "pino";
import type { Logger, LogFields } from "@viu/emporix-sdk";

export function pinoAdapter(p: pino.Logger): Logger {
  const wrap = (pp: pino.Logger): Logger => ({
    level: pp.level as Logger["level"],
    isLevelEnabled: (l) => pp.isLevelEnabled(l),
    trace: (m, f?: LogFields) => pp.trace(f ?? {}, m),
    debug: (m, f?: LogFields) => pp.debug(f ?? {}, m),
    info: (m, f?: LogFields) => pp.info(f ?? {}, m),
    warn: (m, f?: LogFields) => pp.warn(f ?? {}, m),
    error: (m, f?: LogFields) => pp.error(f ?? {}, m),
    child: (b) => wrap(pp.child(b)),
  });
  return wrap(p);
}

new EmporixClient({ /* ... */, logger: pinoAdapter(pino()) });
```

### winston

```ts
import winston from "winston";
import type { Logger, LogFields } from "@viu/emporix-sdk";

export function winstonAdapter(w: winston.Logger): Logger {
  const wrap = (ww: winston.Logger): Logger => ({
    level: ww.level as Logger["level"],
    isLevelEnabled: (l) => ww.isLevelEnabled(l),
    trace: (m, f?: LogFields) => ww.log("silly", m, f),
    debug: (m, f?: LogFields) => ww.debug(m, f),
    info: (m, f?: LogFields) => ww.info(m, f),
    warn: (m, f?: LogFields) => ww.warn(m, f),
    error: (m, f?: LogFields) => ww.error(m, f),
    child: (b) => wrap(ww.child(b)),
  });
  return wrap(w);
}
```

When you supply your own `Logger`, redaction is your responsibility — the
built-in redactor only runs in the built-in console logger.
