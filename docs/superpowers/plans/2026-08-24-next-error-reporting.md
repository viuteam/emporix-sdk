# Next error reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `@viu/emporix-sdk-next` one generic, consumer-supplied error-reporting
seam, and wire it into the 10 failure points that today degrade silently — without
changing what any of them returns.

**Architecture:** A module-scope sink (`setEmporixErrorReporter`), registered once
from Next's `instrumentation.ts`. It cannot be a `getEmporixClient` option: that
factory is memoized on a **string** key, and a function cannot be keyed, so the
first caller's reporter would silently win for the whole process. The package ships
the interface and no implementation — the same split as `EmporixSessionStore`, which
keeps the zero-runtime-dependency property intact. Every call site keeps its current
return value; reporting is additive.

**Tech Stack:** TypeScript (`exactOptionalPropertyTypes: true`,
`noUncheckedIndexedAccess: true`), Vitest, `redact()` from `@viu/emporix-sdk`,
changesets.

**Spec:** [`docs/superpowers/specs/2026-08-24-next-error-reporting-design.md`](../specs/2026-08-24-next-error-reporting-design.md)

## Global Constraints

- **English only** in every committed artefact — code, comments, tests, docs,
  changeset, commit messages.
- **Commitlint:** scope from `repo, release, sdk, react, core, customer, product,
  category, cart, checkout, payment, price, media, segment, availability, auth,
  http, logger, deps, docs, examples`; first word after the scope a **lowercase
  verb**; `body-max-line-length` = **100**.
- **`packages/next` must keep zero runtime dependencies.** No vendor SDK, ever.
- **No behaviour change at any call site.** Each one returns exactly what it
  returns today. If a test asserting current behaviour has to change, stop — that
  is a signal the change is wrong, not that the test is.
- **`redact()` before the reporter.** No payload leaves the package unredacted.
- Repo test command is `pnpm test` (filtered to `./packages/*`). **Do not use
  `pnpm -r test`** — that includes the `e2e` project, which boots a server against
  the live `viu` tenant and fails for unrelated reasons.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/next/src/error-reporting.ts` | **new.** The interface, the module-scope registry, and the internal `reportEmporixError` wrapper. Nothing else. |
| `packages/next/tests/error-reporting.test.ts` | **new.** The seam in isolation: fires, is a no-op when unset, contains a throwing reporter, redacts. |
| `packages/next/src/session.ts` | add the two public exports. |
| `packages/next/src/token-proxy.ts` | 1 site. |
| `packages/next/src/session-cookies.ts` | 1 site. |
| `packages/next/src/session-auth.ts` | 2 sites. |
| `packages/next/src/session-client.ts` | 2 sites. |
| `packages/next/src/webhook.ts` | 3 sites. |
| `packages/next/src/cookie-name.ts` | 1 site. |
| `packages/next/tests/error-reporting-silence.test.ts` | **new.** Asserts the 5 deliberately-silent sites stay silent. |
| `packages/next/README.md` | one short section + a link. |
| `examples/next-server-first/instrumentation.ts` | **new.** The one worked adapter. |

Sites live in the files they belong to; there is no central interception point,
because there is no single funnel every failure passes through.

---

### Task 1: The seam

**Files:**
- Create: `packages/next/src/error-reporting.ts`
- Create: `packages/next/tests/error-reporting.test.ts`
- Modify: `packages/next/src/session.ts` (add exports)

**Interfaces:**
- Consumes: `redact` from `@viu/emporix-sdk` — signature
  `redact(value: unknown, extra?: string[]): unknown`.
- Produces:
  - `type EmporixErrorCode` — the closed union of 8 literals listed in Step 3.
  - `interface EmporixErrorEvent { code, degradedTo, severity, cause, context }`.
  - `type EmporixErrorReporter = (event: EmporixErrorEvent) => void`.
  - `setEmporixErrorReporter(reporter: EmporixErrorReporter | null): void` — public.
  - `reportEmporixError(input: ReportInput): void` — **internal**, used by Tasks 2–5.
    `ReportInput` is `{ code: EmporixErrorCode; degradedTo: string; cause: unknown;
    severity?: "warning" | "error"; context?: Record<string, string | number | boolean> }`.
    `severity` defaults to `"error"`.
  - `__resetEmporixErrorReporter(): void` — test-only, mirrors the existing
    `__resetEmporixClients` convention in `client.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/next/tests/error-reporting.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  setEmporixErrorReporter,
  reportEmporixError,
  __resetEmporixErrorReporter,
  type EmporixErrorEvent,
} from "../src/error-reporting";

afterEach(() => __resetEmporixErrorReporter());

describe("the error-reporting seam", () => {
  it("is a no-op with no reporter registered", () => {
    expect(() =>
      reportEmporixError({ code: "session.flush_failed", degradedTo: "x", cause: new Error("e") }),
    ).not.toThrow();
  });

  it("hands the registered reporter a complete event", () => {
    const seen: EmporixErrorEvent[] = [];
    setEmporixErrorReporter((e) => seen.push(e));
    const cause = new Error("redis down");
    reportEmporixError({
      code: "session.store.read_failed",
      degradedTo: "request continues as a logged-out visitor",
      cause,
      context: { site: "token-proxy" },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.code).toBe("session.store.read_failed");
    expect(seen[0]?.degradedTo).toBe("request continues as a logged-out visitor");
    expect(seen[0]?.cause).toBe(cause);
    expect(seen[0]?.context).toEqual({ site: "token-proxy" });
  });

  it("defaults severity to error and takes warning when asked", () => {
    const seen: EmporixErrorEvent[] = [];
    setEmporixErrorReporter((e) => seen.push(e));
    reportEmporixError({ code: "session.flush_failed", degradedTo: "x", cause: null });
    reportEmporixError({
      code: "session.logout_upstream_failed",
      degradedTo: "y",
      cause: null,
      severity: "warning",
    });
    expect(seen.map((e) => e.severity)).toEqual(["error", "warning"]);
  });

  it("redacts the context before the reporter sees it", () => {
    const seen: EmporixErrorEvent[] = [];
    setEmporixErrorReporter((e) => seen.push(e));
    reportEmporixError({
      code: "session.store.read_failed",
      degradedTo: "x",
      cause: null,
      context: { authorization: "Bearer super-secret", site: "proxy" },
    });
    expect(JSON.stringify(seen[0]?.context)).not.toContain("super-secret");
    expect(seen[0]?.context.site).toBe("proxy");
  });

  it("contains a throwing reporter — the caller must not learn about it", () => {
    setEmporixErrorReporter(() => {
      throw new Error("the tool is down");
    });
    expect(() =>
      reportEmporixError({ code: "webhook.handler_failed", degradedTo: "x", cause: null }),
    ).not.toThrow();
  });

  it("unregisters on null", () => {
    const fn = vi.fn();
    setEmporixErrorReporter(fn);
    setEmporixErrorReporter(null);
    reportEmporixError({ code: "session.flush_failed", degradedTo: "x", cause: null });
    expect(fn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm -F @viu/emporix-sdk-next exec vitest run tests/error-reporting.test.ts`
Expected: FAIL — `Failed to resolve import "../src/error-reporting"`.

- [ ] **Step 3: Write the minimal implementation**

Create `packages/next/src/error-reporting.ts`:

```ts
import { redact } from "@viu/emporix-sdk";

/**
 * Closed set of failure points this package reports. A stable, greppable
 * identifier rather than a message: the SDK's error messages interpolate tenant
 * and path, so a consumer fingerprinting on the message gets one bucket per
 * request. Group on `code`, read the detail from `cause`.
 */
export type EmporixErrorCode =
  | "session.store.read_failed"
  | "session.flush_failed"
  | "session.cart_onboarding_failed"
  | "session.cookie_undecryptable"
  | "session.anonymous_cookie_unparseable"
  | "session.logout_upstream_failed"
  | "webhook.handler_failed"
  | "webhook.body_unparseable";

export interface EmporixErrorEvent {
  readonly code: EmporixErrorCode;
  /**
   * What the package did as a result — the caller-visible consequence. «Store
   * read failed» is half a signal; what matters on call is that the request
   * then continued as a logged-out visitor.
   */
  readonly degradedTo: string;
  readonly severity: "warning" | "error";
  /**
   * The caught value, unchanged and **not** redacted: a scrubbed stack trace is
   * useless. It may contain whatever the thrower put in it — scrubbing `cause`
   * is the consumer's decision, not this package's.
   */
  readonly cause: unknown;
  /** Primitives only, already through `redact()`. Never holds a token. */
  readonly context: Readonly<Record<string, string | number | boolean>>;
}

export type EmporixErrorReporter = (event: EmporixErrorEvent) => void;

interface ReportInput {
  code: EmporixErrorCode;
  degradedTo: string;
  cause: unknown;
  severity?: "warning" | "error";
  context?: Record<string, string | number | boolean>;
}

let reporter: EmporixErrorReporter | null = null;

/**
 * Registers the process-wide error reporter. Call it once from Next's
 * `instrumentation.ts`, whose `register()` runs before the first request.
 *
 * Module scope rather than a `getEmporixClient` option on purpose: that factory
 * is memoized on a string key, and a function cannot go in a string key — so a
 * per-client reporter would mean the first caller silently wins for the whole
 * process.
 *
 * The package ships no implementation. Pass `null` to unregister.
 */
export function setEmporixErrorReporter(next: EmporixErrorReporter | null): void {
  reporter = next;
}

/**
 * Internal. Reports and returns — never throws, never yields a value a caller
 * has to handle, so it is safe to call from inside a `catch` without adding a
 * second failure mode. Synchronous by design: a reporter that wants I/O queues
 * it itself rather than putting the request's critical path behind a network hop.
 */
export function reportEmporixError(input: ReportInput): void {
  const r = reporter;
  if (r === null) return;
  try {
    r({
      code: input.code,
      degradedTo: input.degradedTo,
      severity: input.severity ?? "error",
      cause: input.cause,
      context: redact(input.context ?? {}) as Readonly<
        Record<string, string | number | boolean>
      >,
    });
  } catch {
    // A broken reporter must not become the failure it was meant to report.
  }
}

/** Test-only: clears the registration so each test starts clean. */
export function __resetEmporixErrorReporter(): void {
  reporter = null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk-next exec vitest run tests/error-reporting.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Export the two public symbols**

In `packages/next/src/session.ts`, after the existing
`export { createEmporixPublicRoute } from "./public-route";` line, add:

```ts
export {
  setEmporixErrorReporter,
  type EmporixErrorReporter,
  type EmporixErrorEvent,
  type EmporixErrorCode,
} from "./error-reporting";
```

`reportEmporixError` and `__resetEmporixErrorReporter` stay unexported from the
entry — the first is internal, the second is test-only.

- [ ] **Step 6: Verify the entry compiles and nothing else moved**

Run: `pnpm -F @viu/emporix-sdk-next typecheck && pnpm -F @viu/emporix-sdk-next test`
Expected: both exit 0; the existing 248 tests still pass.

- [ ] **Step 7: Commit**

```bash
git add packages/next/src/error-reporting.ts packages/next/tests/error-reporting.test.ts packages/next/src/session.ts
git commit -m "feat(repo): add a generic error-reporting seam to the next package"
```

---

### Task 2: The two store reads

Both degrade a store outage into «no session», which logs every visitor out with
no trace. Same code, two places.

**Files:**
- Modify: `packages/next/src/token-proxy.ts:75`
- Modify: `packages/next/src/session-cookies.ts:186-191`
- Test: `packages/next/tests/token-proxy.test.ts`, `packages/next/tests/session-client.test.ts`

**Interfaces:**
- Consumes: `reportEmporixError` from Task 1.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Append to `packages/next/tests/token-proxy.test.ts`. Match the file's existing
setup for building a `NextRequest` and a store — read the top of the file first
and reuse its helpers rather than inventing new ones.

```ts
describe("emporixTokenProxy — store failures are reported", () => {
  afterEach(() => __resetEmporixErrorReporter());

  it("reports a failed store read and still continues as logged out", async () => {
    const seen: EmporixErrorEvent[] = [];
    setEmporixErrorReporter((e) => seen.push(e));
    const store = {
      read: vi.fn().mockRejectedValue(new Error("redis down")),
      write: vi.fn(),
      destroy: vi.fn(),
    };
    // Build the request the way the tests above this one do, with a sid cookie set.
    const res = await emporixTokenProxy(requestWithSid("sid-1"), { store });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.code).toBe("session.store.read_failed");
    expect(seen[0]?.severity).toBe("error");
    // The degradation is unchanged: no throw, the response still passes through.
    expect(res.status).toBeLessThan(500);
  });
});
```

Add the imports at the top of the file:

```ts
import {
  setEmporixErrorReporter,
  __resetEmporixErrorReporter,
  type EmporixErrorEvent,
} from "../src/error-reporting";
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm -F @viu/emporix-sdk-next exec vitest run tests/token-proxy.test.ts`
Expected: FAIL — `seen` is empty, `expected 0 to be 1`.

- [ ] **Step 3: Wire the proxy site**

In `packages/next/src/token-proxy.ts`, replace line 75:

```ts
    const record = sid === null ? null : await opts.store.read(sid).catch(() => null);
```

with:

```ts
    const record =
      sid === null
        ? null
        : await opts.store.read(sid).catch((cause: unknown) => {
            reportEmporixError({
              code: "session.store.read_failed",
              degradedTo: "request continues as a logged-out visitor",
              cause,
              context: { site: "token-proxy" },
            });
            return null;
          });
```

Add to the imports at the top of the file:

```ts
import { reportEmporixError } from "./error-reporting";
```

- [ ] **Step 4: Wire the handle site**

In `packages/next/src/session-cookies.ts`, replace:

```ts
    try {
      record = (await store.read(sid)) ?? {};
    } catch {
      // A store outage degrades to «logged out», not to a 500 on every page.
      record = {};
    }
```

with:

```ts
    try {
      record = (await store.read(sid)) ?? {};
    } catch (cause) {
      // A store outage degrades to «logged out», not to a 500 on every page.
      // Unchanged — but no longer silent.
      reportEmporixError({
        code: "session.store.read_failed",
        degradedTo: "handle resolves with an empty record; the visitor reads as logged out",
        cause,
        context: { site: "session-handle" },
      });
      record = {};
    }
```

Add the same import to that file.

- [ ] **Step 5: Run both test files**

Run: `pnpm -F @viu/emporix-sdk-next exec vitest run tests/token-proxy.test.ts tests/session-client.test.ts`
Expected: PASS. The new test passes and **every pre-existing test in both files
still passes** — that is the no-behaviour-change gate.

- [ ] **Step 6: Commit**

```bash
git add packages/next/src/token-proxy.ts packages/next/src/session-cookies.ts packages/next/tests/token-proxy.test.ts
git commit -m "feat(repo): report failed session-store reads"
```

---

### Task 3: The two write-path failures

The revenue-relevant pair: a lost guest cart on login, and a lost flush while
unwinding.

**Files:**
- Modify: `packages/next/src/session-auth.ts:142`
- Modify: `packages/next/src/session-client.ts:175`
- Test: `packages/next/tests/session-auth.test.ts`, `packages/next/tests/session-client.test.ts`

**Interfaces:**
- Consumes: `reportEmporixError` from Task 1.
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests**

Append to `packages/next/tests/session-auth.test.ts`, reusing that file's existing
login harness:

```ts
describe("emporixLogin — a failed cart onboarding is reported", () => {
  afterEach(() => __resetEmporixErrorReporter());

  it("reports and still leaves the customer logged in", async () => {
    const seen: EmporixErrorEvent[] = [];
    setEmporixErrorReporter((e) => seen.push(e));
    // Make the cart step fail — mock carts.getCurrent (or carts.merge) to reject,
    // following how the tests above this one stub the client.
    await emporixLogin({ email: "a@b.co", password: "p" }, optsWithFailingCart());

    expect(seen.map((e) => e.code)).toContain("session.cart_onboarding_failed");
    // The login itself must still have succeeded — assert the token was persisted
    // exactly as the existing success-path test does.
  });
});
```

Append to `packages/next/tests/session-client.test.ts`:

```ts
describe("withEmporixSessionMutable — a failed flush during unwind is reported", () => {
  afterEach(() => __resetEmporixErrorReporter());

  it("reports the flush failure and still rethrows the caller's error", async () => {
    const seen: EmporixErrorEvent[] = [];
    setEmporixErrorReporter((e) => seen.push(e));
    const store = {
      read: vi.fn().mockResolvedValue({}),
      write: vi.fn().mockRejectedValue(new Error("redis down")),
      destroy: vi.fn(),
    };
    const callerError = new Error("the action failed");

    await expect(
      withEmporixSessionMutable(() => {
        throw callerError;
      }, { store }),
    ).rejects.toBe(callerError);

    expect(seen.map((e) => e.code)).toContain("session.flush_failed");
  });
});
```

`rejects.toBe(callerError)` is the load-bearing assertion: the flush failure must
not replace the error the caller needs to see.

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm -F @viu/emporix-sdk-next exec vitest run tests/session-auth.test.ts tests/session-client.test.ts`
Expected: FAIL on both new tests — `seen` empty.

- [ ] **Step 3: Wire the cart-onboarding site**

In `packages/next/src/session-auth.ts`, the `} catch {` at line 142 closes the try
around `onboardCart`'s `withEmporixSessionMutable`. **There are two `} catch {`
in this file** — this is the one immediately followed by
`// Ignore — the customer is logged in either way.`. Replace:

```ts
  } catch {
    // Ignore — the customer is logged in either way.
  }
```

with:

```ts
  } catch (cause) {
    // Ignore — the customer is logged in either way. Unchanged, but a failure
    // here silently drops the guest cart, so it no longer passes unremarked.
    reportEmporixError({
      code: "session.cart_onboarding_failed",
      degradedTo: "customer is logged in, but their guest cart was not carried over",
      cause,
    });
  }
```

Add `import { reportEmporixError } from "./error-reporting";` to that file.

- [ ] **Step 4: Wire the flush site**

In `packages/next/src/session-client.ts`, replace:

```ts
  } catch (e) {
    if (!readOnly) await handle.flush().catch(() => {});
    throw e;
  }
```

with:

```ts
  } catch (e) {
    if (!readOnly) {
      await handle.flush().catch((cause: unknown) => {
        reportEmporixError({
          code: "session.flush_failed",
          degradedTo:
            "session may still point at a rotated anonymous token; the guest can lose their cart",
          cause,
        });
      });
    }
    throw e;
  }
```

The `throw e` stays exactly where it is.

- [ ] **Step 5: Run both test files**

Run: `pnpm -F @viu/emporix-sdk-next exec vitest run tests/session-auth.test.ts tests/session-client.test.ts`
Expected: PASS, including every pre-existing test.

- [ ] **Step 6: Commit**

```bash
git add packages/next/src/session-auth.ts packages/next/src/session-client.ts packages/next/tests/session-auth.test.ts packages/next/tests/session-client.test.ts
git commit -m "feat(repo): report lost cart onboarding and failed session flushes"
```

---

### Task 4: The webhook route

Three sites, one of which is the highest-value event in the whole set: the
consumer's own handler failing in the consumer's deployment.

**Files:**
- Modify: `packages/next/src/webhook.ts:63`, `:157`, `:169`
- Test: `packages/next/tests/webhook.test.ts`

**Interfaces:**
- Consumes: `reportEmporixError` from Task 1.
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests**

Append to `packages/next/tests/webhook.test.ts`, reusing that file's signing helper
so the deliveries verify:

```ts
describe("createEmporixWebhookRoute — failures are reported", () => {
  afterEach(() => __resetEmporixErrorReporter());

  it("reports a throwing onEvent and still answers 500 so Emporix retries", async () => {
    const seen: EmporixErrorEvent[] = [];
    setEmporixErrorReporter((e) => seen.push(e));
    const route = createEmporixWebhookRoute({
      secret: SECRET,
      onEvent: () => {
        throw new Error("my handler broke");
      },
    });
    const res = await route(signedRequest(VALID_EVENT));

    expect(res.status).toBe(500);
    expect(seen[0]?.code).toBe("webhook.handler_failed");
    expect(seen[0]?.severity).toBe("error");
  });

  it("reports an unparseable body at warning and still answers 401", async () => {
    const seen: EmporixErrorEvent[] = [];
    setEmporixErrorReporter((e) => seen.push(e));
    const route = createEmporixWebhookRoute({ secret: SECRET });
    const res = await route(signedRequest("{not json"));

    expect(res.status).toBe(401);
    expect(seen.map((e) => e.code)).toContain("webhook.body_unparseable");
    expect(seen[0]?.severity).toBe("warning");
  });
});
```

Note the second case answers **401**, not 400: an unparseable body fails signature
verification first, at line 63. Assert what the route actually does today — check
the existing tests for the exact status before writing the number.

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm -F @viu/emporix-sdk-next exec vitest run tests/webhook.test.ts`
Expected: FAIL — `seen` empty on both.

- [ ] **Step 3: Wire the verification site (line 63)**

Replace:

```ts
    try {
      signedPayload = canonicalJson(JSON.parse(rawBody));
    } catch {
      return false;
    }
```

with:

```ts
    try {
      signedPayload = canonicalJson(JSON.parse(rawBody));
    } catch (cause) {
      reportEmporixError({
        code: "webhook.body_unparseable",
        degradedTo: "signature verification fails; the delivery is rejected",
        cause,
        severity: "warning",
        context: { stage: "verify" },
      });
      return false;
    }
```

- [ ] **Step 4: Wire the parse site (line 157)**

Replace:

```ts
    try {
      event = JSON.parse(rawBody) as EmporixWebhookEvent;
    } catch {
      return new Response("unparseable body", { status: 400 });
    }
```

with:

```ts
    try {
      event = JSON.parse(rawBody) as EmporixWebhookEvent;
    } catch (cause) {
      reportEmporixError({
        code: "webhook.body_unparseable",
        degradedTo: "400 to Emporix; nothing revalidated",
        cause,
        severity: "warning",
        context: { stage: "parse" },
      });
      return new Response("unparseable body", { status: 400 });
    }
```

- [ ] **Step 5: Wire the handler site (line 169)**

Replace:

```ts
      try {
        await opts.onEvent(event);
      } catch {
        return new Response("handler failed", { status: 500 });
      }
```

with:

```ts
      try {
        await opts.onEvent(event);
      } catch (cause) {
        // The consumer's own handler, failing in the consumer's deployment. The
        // 500 makes Emporix retry; without this they had no stack anywhere.
        reportEmporixError({
          code: "webhook.handler_failed",
          degradedTo: "500 to Emporix, which will retry the delivery",
          cause,
          context: { eventType: typeof event.type === "string" ? event.type : "unknown" },
        });
        return new Response("handler failed", { status: 500 });
      }
```

Add `import { reportEmporixError } from "./error-reporting";` to the file.

- [ ] **Step 6: Run the test file**

Run: `pnpm -F @viu/emporix-sdk-next exec vitest run tests/webhook.test.ts`
Expected: PASS, including every pre-existing test. Every status code the route
returned before must be unchanged.

- [ ] **Step 7: Commit**

```bash
git add packages/next/src/webhook.ts packages/next/tests/webhook.test.ts
git commit -m "feat(repo): report webhook handler and body failures"
```

---

### Task 5: The three warning-level sites, and a guard on the silent five

**Files:**
- Modify: `packages/next/src/cookie-name.ts:51-55`
- Modify: `packages/next/src/session-client.ts:84`
- Modify: `packages/next/src/session-auth.ts:276`
- Create: `packages/next/tests/error-reporting-silence.test.ts`

**Interfaces:**
- Consumes: `reportEmporixError` from Task 1.
- Produces: nothing new.

- [ ] **Step 1: Write the failing silence test**

Create `packages/next/tests/error-reporting-silence.test.ts`. This is the
regression that stops a later refactor from turning the channel into noise:

```ts
import { describe, it, expect, afterEach } from "vitest";
import {
  setEmporixErrorReporter,
  __resetEmporixErrorReporter,
  type EmporixErrorEvent,
} from "../src/error-reporting";
import { emporixTagsForUrl } from "../src/tags";
import { createProxyFetch } from "../src/public-client";
import { createEmporixPublicRoute } from "../src/public-route";

afterEach(() => __resetEmporixErrorReporter());

function collect(): EmporixErrorEvent[] {
  const seen: EmporixErrorEvent[] = [];
  setEmporixErrorReporter((e) => seen.push(e));
  return seen;
}

describe("deliberately silent paths stay silent", () => {
  it("a malformed URL in the tag allowlist reports nothing", () => {
    const seen = collect();
    expect(emporixTagsForUrl("not a url", "acme")).toEqual([]);
    expect(seen).toEqual([]);
  });

  it("a relative URL in the proxy fetch reports nothing", async () => {
    const seen = collect();
    const f = createProxyFetch({ base: "/api/emporix" });
    // A relative URL takes the pass-through branch. Stub globalThis.fetch the way
    // tests/public-route.test.ts does so nothing leaves the process.
    await f("/local/thing").catch(() => undefined);
    expect(seen).toEqual([]);
  });

  it("a cross-origin request rejected by the public route reports nothing", async () => {
    const seen = collect();
    const route = createEmporixPublicRoute({ tenant: "acme" });
    const res = await route(
      new Request("https://app.example/api/emporix/product/acme/products", {
        headers: { "sec-fetch-site": "cross-site" },
      }),
      { params: Promise.resolve({ path: ["product", "acme", "products"] }) },
    );
    expect(res.status).toBe(403);
    expect(seen).toEqual([]);
  });
});
```

`cookie-crypto.ts`'s per-key retry and `request-scope.ts`'s rethrow are the other
two silent sites. Neither is reachable without reaching into internals, and both
are silent by construction — the first throws when every key fails, the second
rethrows. They are covered by the fact that nothing in Tasks 1–5 touches them; no
test is added, and that is deliberate rather than an omission.

- [ ] **Step 2: Run it — it should already pass**

Run: `pnpm -F @viu/emporix-sdk-next exec vitest run tests/error-reporting-silence.test.ts`
Expected: PASS. This one is written before the change to prove it holds after.

- [ ] **Step 3: Write the failing tests for the three warning sites**

Append to `packages/next/tests/session-auth.test.ts`:

```ts
describe("emporixLogout — a failed upstream logout is reported", () => {
  afterEach(() => __resetEmporixErrorReporter());

  it("reports at warning and still clears the local session", async () => {
    const seen: EmporixErrorEvent[] = [];
    setEmporixErrorReporter((e) => seen.push(e));
    // Stub customers.logout to reject, following the harness used above.
    await emporixLogout(optsWithFailingLogout());

    expect(seen.map((e) => e.code)).toContain("session.logout_upstream_failed");
    expect(seen[0]?.severity).toBe("warning");
    // Assert the local clear happened exactly as the existing logout test does.
  });
});
```

Append to `packages/next/tests/session-client.test.ts`:

```ts
describe("the anonymous-session cookie", () => {
  afterEach(() => __resetEmporixErrorReporter());

  it("reports an unparseable value at warning and reads as no session", async () => {
    const seen: EmporixErrorEvent[] = [];
    setEmporixErrorReporter((e) => seen.push(e));
    // Seed STORAGE_KEYS.anonymousSession with "{not json" through the same handle
    // helper the tests above use, then trigger the store's read().
    const session = readAnonymousSessionWith("{not json");

    expect(session).toBeNull();
    expect(seen.map((e) => e.code)).toContain("session.anonymous_cookie_unparseable");
  });
});
```

For `cookie-name.ts`, add to `packages/next/tests/cookie-crypto.test.ts` (that file
already sets `EMPORIX_COOKIE_SECRET` and knows the sealing format):

```ts
describe("reading a cookie sealed with a key that is gone", () => {
  afterEach(() => __resetEmporixErrorReporter());

  it("reports at warning and reads as absent", () => {
    const seen: EmporixErrorEvent[] = [];
    setEmporixErrorReporter((e) => seen.push(e));
    // Seal with one key, then re-read with a different key configured.
    const value = readSealedWithRotatedAwayKey();

    expect(value).toBeNull();
    expect(seen.map((e) => e.code)).toContain("session.cookie_undecryptable");
  });
});
```

- [ ] **Step 4: Run them to make sure they fail**

Run: `pnpm -F @viu/emporix-sdk-next exec vitest run tests/session-auth.test.ts tests/session-client.test.ts tests/cookie-crypto.test.ts`
Expected: FAIL on the three new tests.

- [ ] **Step 5: Wire `cookie-name.ts`**

Replace:

```ts
  try {
    return decryptCookie(name, raw);
  } catch {
    return null;
  }
```

with:

```ts
  try {
    return decryptCookie(name, raw);
  } catch (cause) {
    // Either a rotation dropped a key that is still in use, or the value was
    // tampered with. Both are worth a signal; neither should 500 the page.
    reportEmporixError({
      code: "session.cookie_undecryptable",
      degradedTo: "cookie reads as absent",
      cause,
      severity: "warning",
      context: { cookie: name },
    });
    return null;
  }
```

`name` is the cookie **name**, not its value — safe to include, and it is what
tells you which key rotation went wrong.

- [ ] **Step 6: Wire the anonymous-session parse in `session-client.ts`**

This is the `} catch {` at line 84, inside the store's `read`. Replace:

```ts
      } catch {
        return null;
      }
```

with:

```ts
      } catch (cause) {
        reportEmporixError({
          code: "session.anonymous_cookie_unparseable",
          degradedTo: "guest reads as having no anonymous session and gets a fresh one",
          cause,
          severity: "warning",
        });
        return null;
      }
```

- [ ] **Step 7: Wire the logout site in `session-auth.ts`**

This is the second `} catch {` in the file, the one followed by
`// Ignore — proceed to clear locally.`. Replace:

```ts
    } catch {
      // Ignore — proceed to clear locally.
    }
```

with:

```ts
    } catch (cause) {
      // Ignore — proceed to clear locally. The local session goes either way,
      // but the token stays valid at Emporix until it expires on its own.
      reportEmporixError({
        code: "session.logout_upstream_failed",
        degradedTo: "local session cleared; the customer token was not invalidated upstream",
        cause,
        severity: "warning",
      });
    }
```

- [ ] **Step 8: Run the whole package suite**

Run: `pnpm -F @viu/emporix-sdk-next test`
Expected: PASS. All three new tests pass, the silence test still passes, and the
248 pre-existing tests are untouched.

- [ ] **Step 9: Commit**

```bash
git add packages/next/src/cookie-name.ts packages/next/src/session-client.ts packages/next/src/session-auth.ts packages/next/tests/
git commit -m "feat(repo): report cookie, logout and anonymous-session failures at warning"
```

---

### Task 6: The example adapter, the docs and the changeset

**Files:**
- Create: `examples/next-server-first/instrumentation.ts`
- Modify: `packages/next/README.md`
- Create: `.changeset/next-error-reporting.md`

**Interfaces:**
- Consumes: `setEmporixErrorReporter` and `EmporixErrorEvent` from Task 1.
- Produces: nothing.

- [ ] **Step 1: Write the example adapter**

Create `examples/next-server-first/instrumentation.ts`:

```ts
/**
 * The one worked error-reporting adapter. Deliberately console-only: the point
 * is the shape of the wiring, not a vendor. Swap the body for your tool.
 *
 * Next runs `register()` once per server process, before the first request —
 * which is why the seam is module-scope rather than a per-client option.
 */
import { setEmporixErrorReporter } from "@viu/emporix-sdk-next/session";

export async function register(): Promise<void> {
  setEmporixErrorReporter((event) => {
    // Group on `event.code`, never on a message: the SDK interpolates tenant and
    // path into messages, so a message fingerprint yields one bucket per request.
    // eslint-disable-next-line no-console
    console[event.severity === "warning" ? "warn" : "error"]("[emporix]", {
      code: event.code,
      degradedTo: event.degradedTo,
      context: event.context,
      cause: event.cause instanceof Error ? event.cause.message : String(event.cause),
    });
  });
}
```

The `eslint-disable-next-line no-console` matches how the three storage adapters
in this repo already handle deliberate console use.

- [ ] **Step 2: Verify the example still typechecks and builds**

Run: `pnpm -F @viu/emporix-sdk-next build && pnpm -F @viu/emporix-examples-next-server-first typecheck && pnpm -F @viu/emporix-examples-next-server-first build`
Expected: all exit 0. The package must be built first — the examples typecheck
against `dist/`, not against source.

- [ ] **Step 3: Add the README section**

In `packages/next/README.md`, after the `### CSRF` section, add:

```markdown
### Error reporting

The package reports its own silent degradations to a reporter you register once —
there is no built-in tool, and no runtime dependency is added:

```ts
// instrumentation.ts
import { setEmporixErrorReporter } from "@viu/emporix-sdk-next/session";

export async function register() {
  setEmporixErrorReporter((e) => myTool.capture(e.code, { level: e.severity, extra: e.context, cause: e.cause }));
}
```

Ten failure points report — a failed session-store read, a guest cart that did not
survive login, a flush lost while unwinding, a throwing webhook handler, and six
more. Each event carries a stable `code` to group on, a `degradedTo` naming what
the package did instead, and a `cause`. **`context` is redacted; `cause` is not** —
a scrubbed stack is useless, so scrubbing it is your call.

Five other `catch` sites stay deliberately silent, including the per-key retry
during cookie-secret rotation. See
[`docs/superpowers/specs/2026-08-24-next-error-reporting-design.md`](https://github.com/viuteam/emporix-sdk/blob/main/docs/superpowers/specs/2026-08-24-next-error-reporting-design.md)
for the full inventory and the reasoning per site.
```

- [ ] **Step 4: Write the changeset**

Create `.changeset/next-error-reporting.md`:

```markdown
---
"@viu/emporix-sdk-next": minor
---

feat(repo): add a generic error-reporting seam

`setEmporixErrorReporter(fn)` registers one process-wide reporter, from Next's
`instrumentation.ts`. The package ships the interface and **no implementation** —
the same split as `EmporixSessionStore` — so its zero-runtime-dependency property
is unchanged and no vendor is chosen for you.

Ten failure points that degraded silently now report: both session-store reads, a
guest cart lost during login, a flush lost while unwinding a Server Action error, a
throwing webhook `onEvent`, plus cookie decryption, anonymous-cookie parsing,
upstream logout and two webhook body-parse sites at `warning`.

**No behaviour changes.** Every one of those sites returns exactly what it
returned before; reporting is additive. Five further `catch` sites stay
deliberately silent — a regression test asserts they do.

Events carry a stable `code` to group on (never a message: the SDK interpolates
tenant and path into those), a `degradedTo` describing the consequence, and the
original `cause`. `context` goes through the SDK's `redact()`; `cause` does not,
because a scrubbed stack trace is useless — scrubbing it is the consumer's call.
```

- [ ] **Step 5: Full verification**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm changeset status --since=origin/main
```

Expected: typecheck and lint exit 0; tests pass; `changeset status` lists
`@viu/emporix-sdk-next` under minor.

- [ ] **Step 6: Commit**

```bash
git add examples/next-server-first/instrumentation.ts packages/next/README.md .changeset/next-error-reporting.md
git commit -m "docs(repo): document the error-reporting seam and add an example adapter"
```

---

## Self-review

**Spec coverage.** The interface (Task 1), all 10 reporting sites (Tasks 2–5), the
silence guard for the deliberately-quiet 5 (Task 5), redaction (Task 1 Step 3 plus
its test), the containment of a throwing reporter (Task 1), the no-implementation
rule and the example adapter (Task 6), docs (Task 6). The spec's «Assumptions to
verify» are not tasks by design — see below.

**Placeholders.** Four test steps say «reuse the harness this file already has»
rather than reproducing a setup helper: Task 2 Step 1 (`requestWithSid`), Task 3
Step 1 (`optsWithFailingCart`), Task 5 Step 3 (`optsWithFailingLogout`,
`readAnonymousSessionWith`, `readSealedWithRotatedAwayKey`). These are named
placeholders and the implementer must write them against the existing file. That
is deliberate — inventing a parallel harness would duplicate setup those files
already own — but it is the one place this plan is not copy-paste complete, and
the implementer should read each test file's top before starting.

**Type consistency.** `reportEmporixError` takes one object argument in every
task. `EmporixErrorCode` has 8 members and every `code` used in Tasks 2–5 is one
of them: `session.store.read_failed` (×2), `session.cart_onboarding_failed`,
`session.flush_failed`, `webhook.body_unparseable` (×2), `webhook.handler_failed`,
`session.cookie_undecryptable`, `session.anonymous_cookie_unparseable`,
`session.logout_upstream_failed` — 8 distinct, all declared. `severity` is omitted
where `"error"` is wanted and passed explicitly for all five warnings.

## Open before merge, not before starting

Two things from the spec are decisions, not steps, and should be settled in review
rather than guessed at during implementation:

- **Proxy volume.** `token-proxy.ts` runs before every render, so a store outage
  produces one event per request. Nothing in this plan throttles that. If it
  needs throttling, the interface gains a field and Task 1 changes — which is why
  the question belongs before the first commit, not after the last.
- **`instrumentation.ts` timing.** That `register()` runs before the first request
  is documented for Next 16 and **not measured here**. Task 6 Step 2 only proves
  the example compiles and builds, not that the reporter is registered in time.
