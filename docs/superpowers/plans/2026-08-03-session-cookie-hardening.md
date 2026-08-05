# Session Cookie Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An absolute session ceiling, the `__Host-` prefix and optional
AES-256-GCM encryption of the session cookies — in one release, because two of
them invalidate the same sessions.

**Architecture:** One codec module encapsulates the prefix, encryption and
decryption. The **three** places that read session cookies all go through it —
the cookie jar, the token proxy and `emporixSession`. No second path, otherwise
they drift apart.

**Tech Stack:** `node:crypto` (synchronous, built in, already used inside the
package), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-03-session-cookie-hardening-design.md`

## Global Constraints

- **Branch:** a new branch `feat/session-hardening` off `main` — **only once
  PR #195 has been merged**. This work changes `session-cookies.ts`,
  `session-auth.ts` and `token-proxy.ts`, all of which come from #195. Do not
  stack: a PR that has a feature branch as its base never gets its `quality`
  checks.
- **Push:** `git push origin feat/session-hardening` over SSH. The gh token is
  rejected for git operations over HTTPS; only `gh` as an API client works.
- **Commitlint:** scope from `repo, release, sdk, react, core, customer, product,
  category, cart, checkout, payment, price, media, segment, availability, auth,
  http, logger, deps, docs, examples`. No `next` scope — use `repo`. The first
  word after the scope is a **lowercase verb**.
- **`node:crypto`, not WebCrypto.** `crypto.subtle` is async-only, and
  `AnonymousSessionStore` ([core/auth.ts:42-45](../../../packages/sdk/src/core/auth.ts#L42))
  is declared synchronous and is called synchronously mid token refresh. An
  async codec could not be plugged in there. **No signature becomes async.**
- **Zero runtime dependencies.** The package has none today and keeps none.
- **`exactOptionalPropertyTypes` is on.** An optional field either gets a value
  or does not exist — `{ ...(x ? { k: x } : {}) }`, never `{ k: undefined }`.
- **Swiss Standard German in prose, no sharp s.** Code and comments in
  English, as in the rest of the repo. *(Superseded 2026-08-05: everything committed is English — see `CLAUDE.md`. Kept as the record of the constraint that applied when this plan was written.)*
- **Do not commit real keys.** Test keys are generated inside the test.

---

### Task H1: The cookie codec

**Files:**
- Create: `packages/next/src/cookie-crypto.ts`
- Test: `packages/next/tests/cookie-crypto.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `cookieEncryptionEnabled(): boolean`
  - `encryptCookie(name: string, value: string): string`
  - `decryptCookie(name: string, value: string): string` — throws on every
    failure, never returns an undecrypted value

- [ ] **Step 1: Write the test file**

Create `packages/next/tests/cookie-crypto.test.ts`:

```ts
import { describe, expect, it, afterEach } from "vitest";
import { randomBytes } from "node:crypto";

const { cookieEncryptionEnabled, encryptCookie, decryptCookie } = await import(
  "../src/cookie-crypto"
);

/** A valid 32-byte key, base64url — the format the env var takes. */
function key(): string {
  return randomBytes(32).toString("base64url");
}

afterEach(() => {
  delete process.env.EMPORIX_COOKIE_SECRET;
});

describe("cookie encryption", () => {
  it("round-trips a value", () => {
    process.env.EMPORIX_COOKIE_SECRET = key();
    const sealed = encryptCookie("emporix.customerToken", "tok-1");
    expect(decryptCookie("emporix.customerToken", sealed)).toBe("tok-1");
  });

  it("produces a different ciphertext each time", () => {
    // A fresh IV per call. Identical ciphertexts would leak that two cookies
    // hold the same value.
    process.env.EMPORIX_COOKIE_SECRET = key();
    const a = encryptCookie("emporix.customerToken", "tok-1");
    const b = encryptCookie("emporix.customerToken", "tok-1");
    expect(a).not.toBe(b);
  });

  it("rejects a tampered ciphertext", () => {
    process.env.EMPORIX_COOKIE_SECRET = key();
    const sealed = encryptCookie("emporix.customerToken", "tok-1");
    // Flip the last character of the base64url body.
    const broken = sealed.slice(0, -1) + (sealed.endsWith("A") ? "B" : "A");
    expect(() => decryptCookie("emporix.customerToken", broken)).toThrow();
  });

  it("rejects a ciphertext moved to a different cookie name", () => {
    // The AAD. Without it a saasToken ciphertext could be pasted into the
    // customerToken cookie and would decrypt cleanly.
    process.env.EMPORIX_COOKIE_SECRET = key();
    const sealed = encryptCookie("emporix.saasToken", "saas-1");
    expect(() => decryptCookie("emporix.customerToken", sealed)).toThrow();
  });

  it("decrypts with an older key still in the list", () => {
    const oldKey = key();
    process.env.EMPORIX_COOKIE_SECRET = oldKey;
    const sealed = encryptCookie("emporix.customerToken", "tok-1");
    // Rotation: the new key goes first, the old one stays for reading.
    process.env.EMPORIX_COOKIE_SECRET = `${key()},${oldKey}`;
    expect(decryptCookie("emporix.customerToken", sealed)).toBe("tok-1");
  });

  it("fails once the key leaves the list — the mass-logout lever", () => {
    process.env.EMPORIX_COOKIE_SECRET = key();
    const sealed = encryptCookie("emporix.customerToken", "tok-1");
    process.env.EMPORIX_COOKIE_SECRET = key();
    expect(() => decryptCookie("emporix.customerToken", sealed)).toThrow();
  });

  it("rejects a plaintext value rather than passing it through", () => {
    // No plaintext fallback. Returning the value would silently defeat the
    // integrity guarantee for cartId and activeLegalEntityId.
    process.env.EMPORIX_COOKIE_SECRET = key();
    expect(() => decryptCookie("emporix.customerToken", "tok-1")).toThrow();
  });

  it("rejects a key that is not 32 bytes, naming the fix", () => {
    process.env.EMPORIX_COOKIE_SECRET = randomBytes(16).toString("base64url");
    expect(() => encryptCookie("emporix.customerToken", "tok-1")).toThrow(/randomBytes\(32\)/);
  });

  it("reports encryption off when the variable is absent", () => {
    expect(cookieEncryptionEnabled()).toBe(false);
  });
});
```

- [ ] **Step 2: Test run — must fail**

```bash
pnpm -F @viu/emporix-sdk-next test -- cookie-crypto
```

Expectation: the import fails, `../src/cookie-crypto` does not exist. Note the
test count **before** this task, it goes into the PR description later.

- [ ] **Step 3: Write the codec**

Create `packages/next/src/cookie-crypto.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for session cookie values.
 *
 * `node:crypto`, not WebCrypto, and that is not a preference: `crypto.subtle`
 * is async-only, while `AnonymousSessionStore` (sdk core/auth.ts:42) is declared
 * synchronous and is called mid-refresh. An async codec cannot back it.
 *
 * What this buys, precisely: a stolen ciphertext cannot be redeemed directly
 * against Emporix, only replayed against this app. It does NOT prevent session
 * hijacking — whoever holds the cookie is in either way.
 */
const PREFIX = "v1.";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

const GENERATE =
  'node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'base64url\'))"';

let cachedRaw: string | undefined;
let cachedKeys: Buffer[] = [];

/**
 * The configured keys, first one encrypts. Cached on the raw env string so a
 * changed value is picked up — tests rely on that, and so does a redeploy.
 */
function keys(): Buffer[] {
  const raw = process.env.EMPORIX_COOKIE_SECRET;
  if (raw === undefined || raw.length === 0) {
    cachedRaw = undefined;
    cachedKeys = [];
    return cachedKeys;
  }
  if (raw === cachedRaw) return cachedKeys;
  const parsed = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const buf = Buffer.from(s, "base64url");
      if (buf.length !== KEY_BYTES) {
        throw new Error(
          `EMPORIX_COOKIE_SECRET: every key must be ${KEY_BYTES} base64url bytes, got ${buf.length}. ` +
            `Generate one with: ${GENERATE}`,
        );
      }
      return buf;
    });
  if (parsed.length === 0) {
    throw new Error(`EMPORIX_COOKIE_SECRET is set but empty. Generate a key with: ${GENERATE}`);
  }
  cachedRaw = raw;
  cachedKeys = parsed;
  return cachedKeys;
}

/** Whether `EMPORIX_COOKIE_SECRET` is configured. */
export function cookieEncryptionEnabled(): boolean {
  const raw = process.env.EMPORIX_COOKIE_SECRET;
  return raw !== undefined && raw.length > 0;
}

/** Seals `value` for the cookie called `name`. The name is the AAD. */
export function encryptCookie(name: string, value: string): string {
  const [k] = keys();
  if (k === undefined) throw new Error("encryptCookie called with no key configured");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  cipher.setAAD(Buffer.from(name, "utf8"));
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url");
}

/**
 * Opens a sealed value. Throws on anything unexpected — a plaintext value, a
 * wrong cookie name, a tampered byte, or a key no longer in the list.
 *
 * Never returns the input unchanged: passing plaintext through would quietly
 * defeat the integrity guarantee for `cartId` and `activeLegalEntityId`, which
 * the app trusts.
 */
export function decryptCookie(name: string, value: string): string {
  if (!value.startsWith(PREFIX)) {
    throw new Error(`decryptCookie: ${name} is not sealed (missing ${PREFIX} marker)`);
  }
  const raw = Buffer.from(value.slice(PREFIX.length), "base64url");
  if (raw.length <= IV_BYTES + TAG_BYTES) {
    throw new Error(`decryptCookie: ${name} is too short to be a sealed value`);
  }
  const iv = raw.subarray(0, IV_BYTES);
  const body = raw.subarray(IV_BYTES, raw.length - TAG_BYTES);
  const tag = raw.subarray(raw.length - TAG_BYTES);
  for (const k of keys()) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", k, iv);
      decipher.setAAD(Buffer.from(name, "utf8"));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
    } catch {
      // Wrong key — try the next. A rotation keeps old keys readable.
    }
  }
  throw new Error(`decryptCookie: ${name} could not be opened with any configured key`);
}
```

- [ ] **Step 4: Test run — must pass**

```bash
pnpm -F @viu/emporix-sdk-next test -- cookie-crypto
```

Expectation: 9 tests green.

- [ ] **Step 5: Mutation testing**

Two mutations, each one on its own, each reverted afterwards:

1. Remove both `setAAD` lines → «rejects a ciphertext moved to a different
   cookie name» **must** turn red. That is the test which proves nothing
   without a mutation: round-trip and tamper pass without the AAD as well.
2. In `decryptCookie`, replace the prefix check with `return value` →
   «rejects a plaintext value rather than passing it through» **must** turn
   red.

If one of them is not caught, the test is worthless — then fix the test, do not
keep the mutation.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
pnpm -F @viu/emporix-sdk-next typecheck && pnpm -F @viu/emporix-sdk-next lint
```

```bash
git add packages/next/src/cookie-crypto.ts packages/next/tests/cookie-crypto.test.ts && git commit -m "feat(repo): add an aes-256-gcm codec for session cookies"
```

---

### Task H2: Prefix and codec at all three read sites

**Files:**
- Create: `packages/next/src/cookie-name.ts`
- Modify: `packages/next/src/session-cookies.ts:70-93`
- Modify: `packages/next/src/token-proxy.ts:49-72`
- Modify: `packages/next/src/server-session.ts:50-90`
- Test: `packages/next/tests/session-client.test.ts` (extend)

**Interfaces:**
- Consumes: `encryptCookie`, `decryptCookie`, `cookieEncryptionEnabled` (Task H1).
- Produces:
  - `cookieName(base: string, secure: boolean): string` — prepends `__Host-`
    when `secure`
  - `sealCookie(name: string, value: string): string`
  - `openCookie(name: string, raw: string | undefined): string | null` — `null`
    instead of a throw, so an unreadable cookie behaves like a missing one

- [ ] **Step 1: Write the name and codec module**

Create `packages/next/src/cookie-name.ts`:

```ts
import { cookieEncryptionEnabled, decryptCookie, encryptCookie } from "./cookie-crypto";

/**
 * The wire name of a session cookie.
 *
 * `__Host-` makes the browser enforce Secure, Path=/ and no Domain, which stops
 * a compromised subdomain from injecting a cookie for the parent domain. We
 * already satisfy all three conditions.
 *
 * Tied to the same `secure` derivation the attributes use, deliberately: a
 * browser refuses `__Host-` cookies over plain http, so on a local http host the
 * prefix has to come off — and if that decision lived in a second place the two
 * would drift.
 */
export function cookieName(base: string, secure: boolean): string {
  return secure ? `__Host-${base}` : base;
}

/** Seals a value when a key is configured, passes it through when not. */
export function sealCookie(name: string, value: string): string {
  return cookieEncryptionEnabled() ? encryptCookie(name, value) : value;
}

/**
 * Opens a stored value, or `null` when it cannot be read.
 *
 * `null` rather than a throw: an unreadable cookie must behave like a missing
 * one, so that dropping a key from the rotation list logs everyone out instead
 * of returning 500s. That is the mass-logout lever working as intended.
 */
export function openCookie(name: string, raw: string | undefined): string | null {
  if (raw === undefined) return null;
  if (!cookieEncryptionEnabled()) return raw;
  try {
    return decryptCookie(name, raw);
  } catch {
    return null;
  }
}
```

**Important:** the AAD is the **base name without the prefix**. Otherwise a
switch from http to https would make every cookie unreadable, because the AAD
changes along with the prefix. That is why every caller passes the base name
from `STORAGE_KEYS`, not the result of `cookieName`.

- [ ] **Step 2: Switch the cookie jar over**

In `packages/next/src/session-cookies.ts`, replace the return value of
`sessionCookieJar`:

```ts
  return {
    get: (name) => openCookie(name, jar.get(cookieName(name, secure))?.value),
    set: (name, value, maxAgeSeconds) => {
      if (readOnly) return;
      jar.set(cookieName(name, secure), sealCookie(name, value), {
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        maxAge: maxAgeSeconds,
      });
    },
    delete: (name) => {
      if (readOnly) return;
      jar.delete(cookieName(name, secure));
    },
  };
```

Add the imports at the top:

```ts
import { cookieName, openCookie, sealCookie } from "./cookie-name";
```

- [ ] **Step 3: Switch the token proxy over**

`token-proxy.ts` reads `request.cookies` directly, not through the jar — it runs
in the proxy, where `cookies()` is not available. It needs the same derivation.

In `packages/next/src/token-proxy.ts`, replace the block from `const token = …`:

```ts
  // Same derivation emporixSiteProxy uses; there is no headers() in a proxy.
  const secure = request.nextUrl.protocol === "https:";
  const tokenCookie = cookieName(STORAGE_KEYS.customerToken, secure);
  const token = openCookie(
    STORAGE_KEYS.customerToken,
    request.cookies.get(tokenCookie)?.value,
  );
  if (token !== null) {
    const exp = storedExpiry(
      openCookie(SESSION_EXPIRES_AT, request.cookies.get(cookieName(SESSION_EXPIRES_AT, secure))?.value)
        ?? undefined,
    );
    const skew = opts.skewSeconds ?? 120;
    const stale = exp === null || exp - Math.floor(Date.now() / 1000) <= skew;
    if (stale) {
      const fresh = await emporixRefresh();
      if (fresh !== null) {
        // Make the fresh token visible to THIS render, not just the next one.
        request.cookies.set(tokenCookie, sealCookie(STORAGE_KEYS.customerToken, fresh));
      }
    }
  }
```

`storedExpiry` takes `string | undefined`; `openCookie` returns `string | null`.
The `?? undefined` bridges that — do not change the signature of `storedExpiry`,
it is driven directly by tests.

Add the imports:

```ts
import { cookieName, openCookie, sealCookie } from "./cookie-name";
```

- [ ] **Step 4: Switch `emporixSession` over**

`server-session.ts` builds two `ServerCookieJar` shims that go straight to
`cookies()`. Both get the same treatment.

In `emporixSession` (the read path, around line 51):

```ts
  const jar = await cookies();
  const secure = (await headers()).get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
  const io: ServerCookieJar = {
    get: (name) => openCookie(name, jar.get(cookieName(name, secure))?.value),
  };
```

In `emporixSessionMutable` (around line 82) the same `get`, plus:

```ts
    set: (name, value) => {
      if (value === null) jar.delete(cookieName(name, attrs.secure));
      else jar.set(cookieName(name, attrs.secure), sealCookie(name, value), attrs);
    },
```

`attrs.secure` rather than a derivation of its own, because this function takes
`secure` as an option and the name has to match the attribute being written.

Import `headers` from `next/headers` if it is not there yet.

- [ ] **Step 5: Do NOT touch `emporixSiteProxy`**

`proxy.ts:71-74` writes `emporix.siteCode` and `emporix.language`. Those are
deliberately browser-readable — that is the purpose of the site proxy — and
stay without a prefix and without encryption. No change needed. This step
exists so that nobody goes ahead and does it «for completeness».

- [ ] **Step 6: Extend the tests**

Append to `packages/next/tests/session-client.test.ts`:

```ts
describe("cookie hardening", () => {
  afterEach(() => {
    delete process.env.EMPORIX_COOKIE_SECRET;
  });

  it("stores plaintext when no secret is configured", async () => {
    stubFetch();
    headerBag.set("x-forwarded-proto", "https");
    await withEmporixSessionMutable(async (client, ctx) => {
      await client.products.get("p1", undefined, ctx);
    });
    const written = bag.get("__Host-emporix.anonymousSession");
    expect(written?.val).toContain("sess-1");
  });

  it("stores ciphertext when a secret is configured", async () => {
    process.env.EMPORIX_COOKIE_SECRET = randomBytes(32).toString("base64url");
    stubFetch();
    headerBag.set("x-forwarded-proto", "https");
    await withEmporixSessionMutable(async (client, ctx) => {
      await client.products.get("p1", undefined, ctx);
    });
    const written = bag.get("__Host-emporix.anonymousSession");
    expect(written?.val).toMatch(/^v1\./);
    expect(written?.val).not.toContain("sess-1");
  });

  it("reads back what it wrote, encrypted", async () => {
    process.env.EMPORIX_COOKIE_SECRET = randomBytes(32).toString("base64url");
    stubFetch();
    headerBag.set("x-forwarded-proto", "https");
    await withEmporixSessionMutable(async (client, ctx) => {
      await client.products.get("p1", undefined, ctx);
    });
    const seen = await withEmporixSession(async (_c, ctx) => ctx);
    expect(seen).toEqual({ kind: "anonymous" });
  });

  it("prefixes cookies with __Host- behind https", async () => {
    stubFetch();
    headerBag.set("x-forwarded-proto", "https");
    await withEmporixSessionMutable(async (client, ctx) => {
      await client.products.get("p1", undefined, ctx);
    });
    expect(bag.get("__Host-emporix.anonymousSession")).toBeDefined();
    expect(bag.get("emporix.anonymousSession")).toBeUndefined();
  });

  it("drops the __Host- prefix over plain http", async () => {
    // A browser refuses __Host- without Secure, so a local http host must not
    // get the prefix — same reason secure is derived rather than hard-coded.
    stubFetch();
    headerBag.set("x-forwarded-proto", "http");
    await withEmporixSessionMutable(async (client, ctx) => {
      await client.products.get("p1", undefined, ctx);
    });
    expect(bag.get("emporix.anonymousSession")).toBeDefined();
    expect(bag.get("__Host-emporix.anonymousSession")).toBeUndefined();
  });
});
```

Import `randomBytes` at the top of the file: `import { randomBytes } from "node:crypto";`

Careful: the existing tests in this file expect `emporix.anonymousSession`
**without** a prefix and set no `x-forwarded-proto`. Without that header `secure`
is `false` outside production, so the name stays unprefixed and they keep
passing. Should some fail anyway: do **not** add the header to those tests,
check instead whether they were unintentionally assuming `secure: true`.

- [ ] **Step 7: Full suite, typecheck, commit**

```bash
pnpm -F @viu/emporix-sdk-next test && pnpm -F @viu/emporix-sdk-next typecheck
```

Expectation: all green, 5 tests more than after H1.

```bash
git add packages/next/src packages/next/tests && git commit -m "feat(repo): seal session cookies and add the __Host- prefix"
```

---

### Task H3: Absolute session ceiling

**Files:**
- Modify: `packages/next/src/session-cookies.ts:8-15` (constants)
- Modify: `packages/next/src/session-auth.ts:50-72` (login), `:143-164` (refresh), `:173-197` (logout)
- Test: `packages/next/tests/session-auth.test.ts` (extend)

**Interfaces:**
- Consumes: the jar from H2.
- Produces:
  - `SESSION_ABSOLUTE_MAX = 90 * 24 * 60 * 60`
  - `SESSION_STARTED_AT = "emporix.sessionStartedAt"`
  - `emporixRefresh` returns `null` as soon as the ceiling is passed

- [ ] **Step 1: Add the constants**

In `packages/next/src/session-cookies.ts`, next to `SESSION_EXPIRES_AT`:

```ts
/**
 * Epoch seconds at which this session began. Not refreshed — that is the point.
 *
 * The idle window slides: `persistSession` rewrites the refresh cookie on every
 * refresh, so 30 days means 30 days of INACTIVITY, and an actively used session
 * never expires. This is the ceiling that does not move.
 */
export const SESSION_STARTED_AT = "emporix.sessionStartedAt";

/** How long a session may live regardless of activity. */
export const SESSION_ABSOLUTE_MAX = 90 * 24 * 60 * 60;
```

- [ ] **Step 2: Write the test for the ceiling**

Append to `packages/next/tests/session-auth.test.ts`:

```ts
describe("the absolute session ceiling", () => {
  it("stamps the start at login", async () => {
    stubFetch();
    await emporixLogin({ email: "a@b.test", password: "pw" });
    const started = Number(bag.get("emporix.sessionStartedAt")?.value);
    expect(Math.abs(started - Math.floor(Date.now() / 1000))).toBeLessThan(5);
  });

  it("refreshes normally below the ceiling", async () => {
    stubFetch();
    const young = Math.floor(Date.now() / 1000) - 60;
    bag.set("emporix.sessionStartedAt", { name: "emporix.sessionStartedAt", value: String(young) });
    bag.set("emporix.refreshToken", { name: "emporix.refreshToken", value: "old-refresh" });
    expect(await emporixRefresh()).toBe("cust-tok");
  });

  it("refuses and clears once the ceiling is passed", async () => {
    stubFetch();
    const ancient = Math.floor(Date.now() / 1000) - (91 * 24 * 60 * 60);
    bag.set("emporix.sessionStartedAt", {
      name: "emporix.sessionStartedAt",
      value: String(ancient),
    });
    bag.set("emporix.refreshToken", { name: "emporix.refreshToken", value: "old-refresh" });
    bag.set("emporix.customerToken", { name: "emporix.customerToken", value: "cust-tok" });
    expect(await emporixRefresh()).toBeNull();
    expect(bag.get("emporix.refreshToken")).toBeUndefined();
    expect(bag.get("emporix.customerToken")).toBeUndefined();
  });

  it("does not slide the ceiling across repeated refreshes", async () => {
    // The whole point. If persistSession rewrote this the way it rewrites the
    // refresh cookie, the ceiling would slide with the window it is capping.
    stubFetch();
    const started = Math.floor(Date.now() / 1000) - 1000;
    bag.set("emporix.sessionStartedAt", {
      name: "emporix.sessionStartedAt",
      value: String(started),
    });
    bag.set("emporix.refreshToken", { name: "emporix.refreshToken", value: "old-refresh" });
    for (let i = 0; i < 10; i += 1) await emporixRefresh();
    expect(Number(bag.get("emporix.sessionStartedAt")?.value)).toBe(started);
  });

  it("treats a missing start stamp as a fresh session", async () => {
    // A session that predates this feature has no stamp. Logging those users
    // out on deploy would be a worse trade than letting them run one more cycle.
    stubFetch();
    bag.set("emporix.refreshToken", { name: "emporix.refreshToken", value: "old-refresh" });
    expect(await emporixRefresh()).toBe("cust-tok");
    expect(bag.get("emporix.sessionStartedAt")).toBeDefined();
  });
});
```

- [ ] **Step 3: Test run — must fail**

```bash
pnpm -F @viu/emporix-sdk-next test -- session-auth
```

Expectation: at least «stamps the start at login» and «refuses and clears once
the ceiling is passed» are red.

- [ ] **Step 4: Extract the deletion list**

`emporixLogout` today has an inline list of the cookies to delete. The ceiling
needs that same list — two copies would drift apart the moment somebody adds a
cookie.

In `packages/next/src/session-auth.ts`, above `emporixLogout`:

```ts
/** Every cookie a session owns. One list, because logout and the absolute
 *  ceiling both clear it and must not drift. */
const SESSION_COOKIES = [
  STORAGE_KEYS.customerToken,
  STORAGE_KEYS.refreshToken,
  STORAGE_KEYS.saasToken,
  STORAGE_KEYS.cartId,
  STORAGE_KEYS.activeLegalEntityId,
  STORAGE_KEYS.anonymousSession,
  SESSION_EXPIRES_AT,
  SESSION_STARTED_AT,
] as const;

function clearSession(jar: SessionCookieJar): void {
  for (const name of SESSION_COOKIES) jar.delete(name);
}
```

And in `emporixLogout`, replace the `for` loop with `clearSession(jar);`.

- [ ] **Step 5: Login stamps, refresh checks**

In `emporixLogin`, directly after `persistSession(jar, session);`:

```ts
  jar.set(SESSION_STARTED_AT, String(Math.floor(Date.now() / 1000)), SESSION_ABSOLUTE_MAX);
```

In `emporixRefresh`, as the **first** thing after `const jar = await sessionCookieJar();`:

```ts
  const startedAt = Number(jar.get(SESSION_STARTED_AT));
  if (Number.isFinite(startedAt)) {
    if (Math.floor(Date.now() / 1000) - startedAt > SESSION_ABSOLUTE_MAX) {
      // The ceiling. Clearing here rather than letting the refresh succeed is
      // the whole control: the idle window slides, this does not.
      clearSession(jar);
      return null;
    }
  } else {
    // A session from before this shipped carries no stamp. Adopt it rather than
    // logging the customer out on deploy.
    jar.set(SESSION_STARTED_AT, String(Math.floor(Date.now() / 1000)), SESSION_ABSOLUTE_MAX);
  }
```

Import `SESSION_STARTED_AT` and `SESSION_ABSOLUTE_MAX` at the top.

- [ ] **Step 6: Test run — must pass**

```bash
pnpm -F @viu/emporix-sdk-next test -- session-auth
```

Expectation: all green, 5 tests more than after H2.

- [ ] **Step 7: Mutation testing**

Extend `persistSession` with `jar.set(SESSION_STARTED_AT, String(Math.floor(Date.now()/1000)), SESSION_ABSOLUTE_MAX)`
— that is, make the ceiling slide. The test «does not slide the ceiling across
repeated refreshes» **must** turn red. Revert afterwards.

Without this mutation the test is the claim that something does not happen which
nobody programmed — it only proves anything once it catches the opposite.

- [ ] **Step 8: Full suite, typecheck, commit**

```bash
pnpm -F @viu/emporix-sdk-next test && pnpm typecheck
```

```bash
git add packages/next/src packages/next/tests && git commit -m "feat(repo): cap the session at ninety days regardless of activity"
```

---

### Task H4: Docs, changeset and live verification

**Files:**
- Modify: `packages/next/README.md`
- Modify: `examples/next-server-first/.env.example`
- Modify: `examples/next-server-first/README.md`
- Create: `.changeset/next-session-hardening.md`

**Interfaces:**
- Consumes: everything from H1-H3.
- Produces: nothing in the code.

- [ ] **Step 1: Changeset**

Create `.changeset/next-session-hardening.md`:

```markdown
---
"@viu/emporix-sdk-next": minor
---

Three changes to the session cookies, shipped together because two of them
invalidate every running session and nobody should be logged out twice.

**An absolute session ceiling of 90 days.** The idle window was never a limit:
`persistSession` rewrites the refresh cookie on every refresh, so the documented
30 days meant 30 days of *inactivity* and an actively used session never expired.
A `emporix.sessionStartedAt` stamp is written at login and is not refreshed;
`emporixRefresh` clears the session and returns `null` once it is passed.
Sessions that predate this are adopted rather than dropped.

**The `__Host-` prefix** on every session cookie, which makes the browser enforce
Secure, Path=/ and no Domain — a compromised subdomain can no longer inject a
cookie for the parent domain. Dropped automatically over plain http, where
browsers refuse the prefix.

**Optional AES-256-GCM encryption**, on when `EMPORIX_COOKIE_SECRET` holds a
comma-separated list of base64url 32-byte keys. The first encrypts, all decrypt,
so keys can be rotated without logging everyone out — and removing a key is a
mass-logout lever the stateless design otherwise lacks.

What it buys, stated honestly: a stolen ciphertext cannot be redeemed directly
against Emporix, only replayed against your app, where you can rate-limit and
log. It does **not** prevent session hijacking.

**Upgrading logs every session out**, because cookie names and values both
change. There is deliberately no plaintext fallback: with a 30-day refresh cookie
it would have to stay open for 30 days, and integrity protection would be
worthless for that whole window.
```

- [ ] **Step 2: README section**

In `packages/next/README.md`, after the section on server-first mode:

```markdown
## Session cookie hardening

| Control | Default | Configure with |
|---|---|---|
| Idle window (sliding) | 30 days | `SESSION_MAX_AGE.refreshToken` |
| Absolute ceiling | 90 days | `SESSION_ABSOLUTE_MAX` |
| `__Host-` prefix | on over https | derived, no switch |
| Encryption | off | `EMPORIX_COOKIE_SECRET` |

Generate a key:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Rotate by prepending the new key and keeping the old one for one refresh cycle:

```
EMPORIX_COOKIE_SECRET="<new>,<old>"
```

Drop the old key to log every session out at once.

Encryption does not prevent session hijacking — whoever holds the cookie is in.
What it prevents is a leaked cookie being redeemed *directly against Emporix*,
bypassing your rate limits and your logs. Turning it on invalidates every
running session.
```

- [ ] **Step 3: Example configuration**

Append to `examples/next-server-first/.env.example`:

```
# Optional. Set to enable cookie encryption; generate with:
#   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
# EMPORIX_COOKIE_SECRET=
```

And in `examples/next-server-first/README.md` a line in the «What each page
proves» checklist saying that `/debug` stays green with the secret set too.

- [ ] **Step 4: Full suite over everything**

```bash
pnpm -r --filter "./packages/*" build && pnpm -r test && pnpm typecheck && pnpm lint
```

Expectation: all green. Note the test count — guessed numbers have already been
wrong three times in this repo.

- [ ] **Step 5: Commit**

```bash
git add .changeset packages/next/README.md examples/next-server-first && git commit -m "docs(repo): document the session cookie hardening"
```

- [ ] **Step 6: Live verification without a secret**

```bash
pnpm -F @viu/emporix-examples-next-server-first build
```

Start the server, then in the browser:

1. `/` → product into the cart, `/cart` shows it.
2. In the DevTools: the cookies are named **without** the `__Host-` prefix,
   because localhost runs over http. Values in plaintext.
3. `/debug` is green.

- [ ] **Step 7: Live verification with a secret**

Generate a key, put it into `.env.local`, restart the server.

1. `/cart` shows **«No cart yet»** — the old session is invalid, as
   documented.
2. New product into the cart.
3. In the DevTools: `emporix.cartId` starts with `v1.` and no longer holds the
   cart id in plaintext.
4. `/debug` is green.
5. Replace the key in `.env.local` with a new one, restart the server →
   `/cart` says «No cart yet» again. That is the mass logout.

Point 5 is the evidence for the capability that actually justifies the feature.

- [ ] **Step 8: Measure the `saasToken`**

Open point 2 of the spec. During the logged-in run, note the length of the
`saasToken` cookie once. Encrypted it costs roughly
`1.34 × (n + 28)` bytes; from about 2.9 KB of plaintext onward it breaks the
4 KB per-cookie limit. If it fits, write that into the README; if it does not,
that is a blocker and belongs reported, not worked around.

This step needs a login and therefore the user's own hand on the password
field.

- [ ] **Step 9: PR**

```bash
git push origin feat/session-hardening
```

Open a PR against `main`. Description: the three measures, the finding about the
never-expiring session, the measured test count, and explicitly the note that
the deployment logs everybody out.

**Do not merge.** That is the user's decision.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Absolute ceiling, 90 days | H3 |
| Stamp at login, check at refresh, clear at logout | H3 Steps 4-5 |
| `__Host-` prefix, tied to `secure` | H2 Steps 1-2 |
| Browser-readable cookies stay unprefixed | H2 Step 5 |
| AES-256-GCM, `node:crypto`, synchronous | H1 Step 3 |
| Key list with rotation | H1 Step 3, Tests 5-6 |
| AAD = cookie name | H1 Step 3, Test 4 |
| `v1.` prefix, no plaintext fallback | H1 Step 3, Test 7 |
| All httpOnly cookies incl. `customerTokenExpiresAt` | H2 Steps 2-4 |
| Migration logs everybody out | H4 Steps 1-2, live check Step 7 |
| Tests 1-16 of the spec | H1 Step 1 (1-8), H2 Step 6 (9-13), H3 Step 2 (14-16) |

**Not covered, deliberately:** the non-goals of the spec — server-side sessions,
reuse detection, changes to the React package.

**Beyond the spec, with reason:** the spec does not name the three read sites
individually. The plan does, because `token-proxy.ts` and `server-session.ts`
**bypass** the cookie jar — without H2 Steps 3-4 the encryption would have no
effect there and the proxy would take every value for unreadable. `proxy.ts`
gets a step of its own that says it is *not* touched.

**Type consistency:** `cookieName`, `sealCookie`, `openCookie` are defined in H2
and consumed in H2 Steps 2-4 with exactly these signatures. `clearSession` is
defined in H3 Step 4 and used in Step 5. `SESSION_STARTED_AT` and
`SESSION_ABSOLUTE_MAX` come from H3 Step 1.

**One assumption that H2 Step 6 checks:** that the existing tests in
`session-client.test.ts` run without `x-forwarded-proto` and therefore expect
unprefixed names. The step says what to do if not — and explicitly what not to
do.
