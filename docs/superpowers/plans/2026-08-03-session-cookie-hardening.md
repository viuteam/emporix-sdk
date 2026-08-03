# Session-Cookie-Härtung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine absolute Session-Obergrenze, das `__Host-`-Präfix und optionale
AES-256-GCM-Verschlüsselung der Session-Cookies — in einem Release, weil zwei
davon dieselben Sessions invalidieren.

**Architecture:** Ein Codec-Modul kapselt Präfix, Verschlüsselung und
Entschlüsselung. Die **drei** Stellen, die Session-Cookies lesen, gehen durch
ihn — der Cookie-Jar, der Token-Proxy und `emporixSession`. Kein zweiter Pfad,
sonst driften sie.

**Tech Stack:** `node:crypto` (synchron, eingebaut, im Package bereits genutzt),
Vitest.

**Spec:** `docs/superpowers/specs/2026-08-03-session-cookie-hardening-design.md`

## Global Constraints

- **Branch:** neuer Branch `feat/session-hardening` von `main` — **erst nachdem
  PR #195 gemergt ist**. Diese Arbeit ändert `session-cookies.ts`,
  `session-auth.ts` und `token-proxy.ts`, die alle aus #195 stammen. Nicht
  stacken: ein PR mit Feature-Branch als Basis bekommt seine `quality`-Checks
  nie.
- **Push:** `git push origin feat/session-hardening` über SSH. Der gh-Token wird
  für Git-Operationen über HTTPS abgelehnt; nur `gh` als API-Client geht.
- **Commitlint:** Scope aus `repo, release, sdk, react, core, customer, product,
  category, cart, checkout, payment, price, media, segment, availability, auth,
  http, logger, deps, docs, examples`. Kein `next`-Scope — `repo` nehmen. Erstes
  Wort nach dem Scope ist ein **kleingeschriebenes Verb**.
- **`node:crypto`, nicht WebCrypto.** `crypto.subtle` ist ausschliesslich async,
  und `AnonymousSessionStore` ([core/auth.ts:42-45](../../../packages/sdk/src/core/auth.ts#L42))
  ist synchron deklariert und wird mitten im Token-Refresh sync gerufen. Ein
  async Codec wäre dort nicht anschliessbar. **Keine Signatur wird async.**
- **Null Runtime-Dependencies.** Das Package hat heute keine und behält keine.
- **`exactOptionalPropertyTypes` ist an.** Optionales Feld bekommt einen Wert
  oder existiert nicht — `{ ...(x ? { k: x } : {}) }`, nie `{ k: undefined }`.
- **Schweizer Hochdeutsch in Prosa, kein scharfes S.** Code und Kommentare
  englisch, wie im Rest des Repos.
- **Keine echten Schlüssel committen.** Testschlüssel werden im Test erzeugt.

---

### Task H1: Der Cookie-Codec

**Files:**
- Create: `packages/next/src/cookie-crypto.ts`
- Test: `packages/next/tests/cookie-crypto.test.ts`

**Interfaces:**
- Consumes: nichts.
- Produces:
  - `cookieEncryptionEnabled(): boolean`
  - `encryptCookie(name: string, value: string): string`
  - `decryptCookie(name: string, value: string): string` — wirft bei jedem
    Fehlschlag, gibt nie einen unentschlüsselten Wert zurück

- [ ] **Step 1: Den Testfile schreiben**

Erstelle `packages/next/tests/cookie-crypto.test.ts`:

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

- [ ] **Step 2: Testlauf — muss fehlschlagen**

```bash
pnpm -F @viu/emporix-sdk-next test -- cookie-crypto
```

Erwartung: Import schlägt fehl, `../src/cookie-crypto` gibt es nicht. Notiere
die Testzahl **vor** dieser Task, sie kommt später in die PR-Beschreibung.

- [ ] **Step 3: Den Codec schreiben**

Erstelle `packages/next/src/cookie-crypto.ts`:

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

- [ ] **Step 4: Testlauf — muss durchlaufen**

```bash
pnpm -F @viu/emporix-sdk-next test -- cookie-crypto
```

Erwartung: 9 Tests grün.

- [ ] **Step 5: Mutation testen**

Zwei Mutationen, jede einzeln, jeweils zurückdrehen:

1. Beide `setAAD`-Zeilen entfernen → «rejects a ciphertext moved to a different
   cookie name» **muss** rot werden. Das ist der Test, der ohne Mutation nichts
   beweist: Round-Trip und Tamper bestehen auch ohne AAD.
2. In `decryptCookie` die Präfix-Prüfung durch `return value` ersetzen →
   «rejects a plaintext value rather than passing it through» **muss** rot
   werden.

Wird eine nicht gefangen, ist der Test wertlos — dann den Test reparieren, nicht
die Mutation behalten.

- [ ] **Step 6: Typecheck, Lint, Commit**

```bash
pnpm -F @viu/emporix-sdk-next typecheck && pnpm -F @viu/emporix-sdk-next lint
```

```bash
git add packages/next/src/cookie-crypto.ts packages/next/tests/cookie-crypto.test.ts && git commit -m "feat(repo): add an aes-256-gcm codec for session cookies"
```

---

### Task H2: Präfix und Codec an allen drei Lesestellen

**Files:**
- Create: `packages/next/src/cookie-name.ts`
- Modify: `packages/next/src/session-cookies.ts:70-93`
- Modify: `packages/next/src/token-proxy.ts:49-72`
- Modify: `packages/next/src/server-session.ts:50-90`
- Test: `packages/next/tests/session-client.test.ts` (ergänzen)

**Interfaces:**
- Consumes: `encryptCookie`, `decryptCookie`, `cookieEncryptionEnabled` (Task H1).
- Produces:
  - `cookieName(base: string, secure: boolean): string` — hängt `__Host-` an,
    wenn `secure`
  - `sealCookie(name: string, value: string): string`
  - `openCookie(name: string, raw: string | undefined): string | null` — `null`
    statt Wurf, damit ein unlesbares Cookie wie ein fehlendes wirkt

- [ ] **Step 1: Das Namens- und Codec-Modul schreiben**

Erstelle `packages/next/src/cookie-name.ts`:

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

**Wichtig:** die AAD ist der **Basisname ohne Präfix**. Sonst würde ein Wechsel
von http auf https jedes Cookie unlesbar machen, weil sich die AAD mit dem
Präfix ändert. Alle Aufrufer übergeben deshalb den Basisnamen aus
`STORAGE_KEYS`, nicht das Ergebnis von `cookieName`.

- [ ] **Step 2: Den Cookie-Jar umstellen**

In `packages/next/src/session-cookies.ts`, den Rückgabewert von
`sessionCookieJar` ersetzen:

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

Imports oben ergänzen:

```ts
import { cookieName, openCookie, sealCookie } from "./cookie-name";
```

- [ ] **Step 3: Den Token-Proxy umstellen**

`token-proxy.ts` liest `request.cookies` direkt, nicht über den Jar — es läuft
im Proxy, wo `cookies()` nicht verfügbar ist. Es braucht dieselbe Ableitung.

In `packages/next/src/token-proxy.ts`, den Block ab `const token = …` ersetzen:

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

`storedExpiry` nimmt `string | undefined`; `openCookie` gibt `string | null`.
Das `?? undefined` überbrückt das — nicht die Signatur von `storedExpiry`
ändern, sie wird von Tests direkt gefahren.

Imports ergänzen:

```ts
import { cookieName, openCookie, sealCookie } from "./cookie-name";
```

- [ ] **Step 4: `emporixSession` umstellen**

`server-session.ts` baut zwei `ServerCookieJar`-Shims, die direkt an `cookies()`
gehen. Beide bekommen dieselbe Behandlung.

In `emporixSession` (der Read-Pfad, ca. Zeile 51):

```ts
  const jar = await cookies();
  const secure = (await headers()).get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
  const io: ServerCookieJar = {
    get: (name) => openCookie(name, jar.get(cookieName(name, secure))?.value),
  };
```

In `emporixSessionMutable` (ca. Zeile 82) derselbe `get`, plus:

```ts
    set: (name, value) => {
      if (value === null) jar.delete(cookieName(name, attrs.secure));
      else jar.set(cookieName(name, attrs.secure), sealCookie(name, value), attrs);
    },
```

`attrs.secure` statt einer eigenen Ableitung, weil diese Funktion `secure` als
Option entgegennimmt und der Name zum geschriebenen Attribut passen muss.

`headers` aus `next/headers` importieren, falls noch nicht vorhanden.

- [ ] **Step 5: `emporixSiteProxy` NICHT anfassen**

`proxy.ts:71-74` schreibt `emporix.siteCode` und `emporix.language`. Die sind
absichtlich browserlesbar — das ist der Zweck des Site-Proxys — und bleiben
ohne Präfix und ohne Verschlüsselung. Kein Änderungsbedarf. Dieser Schritt
existiert, damit niemand es «der Vollständigkeit halber» doch macht.

- [ ] **Step 6: Tests ergänzen**

An `packages/next/tests/session-client.test.ts` anhängen:

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

`randomBytes` oben im File importieren: `import { randomBytes } from "node:crypto";`

Achtung: die bestehenden Tests in dieser Datei erwarten `emporix.anonymousSession`
**ohne** Präfix und setzen kein `x-forwarded-proto`. Ohne den Header ist `secure`
ausserhalb von production `false`, also bleibt der Name unpräfixt und sie laufen
weiter. Falls doch welche fehlschlagen: den Header in jenen Tests **nicht**
ergänzen, sondern prüfen, ob sie unbeabsichtigt von `secure: true` ausgingen.

- [ ] **Step 7: Volle Suite, Typecheck, Commit**

```bash
pnpm -F @viu/emporix-sdk-next test && pnpm -F @viu/emporix-sdk-next typecheck
```

Erwartung: alles grün, 5 Tests mehr als nach H1.

```bash
git add packages/next/src packages/next/tests && git commit -m "feat(repo): seal session cookies and add the __Host- prefix"
```

---

### Task H3: Absolute Session-Obergrenze

**Files:**
- Modify: `packages/next/src/session-cookies.ts:8-15` (Konstanten)
- Modify: `packages/next/src/session-auth.ts:50-72` (Login), `:143-164` (Refresh), `:173-197` (Logout)
- Test: `packages/next/tests/session-auth.test.ts` (ergänzen)

**Interfaces:**
- Consumes: den Jar aus H2.
- Produces:
  - `SESSION_ABSOLUTE_MAX = 90 * 24 * 60 * 60`
  - `SESSION_STARTED_AT = "emporix.sessionStartedAt"`
  - `emporixRefresh` gibt `null` zurück, sobald die Decke überschritten ist

- [ ] **Step 1: Konstanten ergänzen**

In `packages/next/src/session-cookies.ts`, neben `SESSION_EXPIRES_AT`:

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

- [ ] **Step 2: Den Test für die Decke schreiben**

An `packages/next/tests/session-auth.test.ts` anhängen:

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

- [ ] **Step 3: Testlauf — muss fehlschlagen**

```bash
pnpm -F @viu/emporix-sdk-next test -- session-auth
```

Erwartung: mindestens «stamps the start at login» und «refuses and clears once
the ceiling is passed» sind rot.

- [ ] **Step 4: Die Löschliste extrahieren**

`emporixLogout` hat heute eine Inline-Liste der zu löschenden Cookies. Die
Decke braucht dieselbe Liste — zwei Kopien würden driften, sobald jemand ein
Cookie ergänzt.

In `packages/next/src/session-auth.ts`, oberhalb von `emporixLogout`:

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

Und in `emporixLogout` die `for`-Schleife durch `clearSession(jar);` ersetzen.

- [ ] **Step 5: Login stempelt, Refresh prüft**

In `emporixLogin`, direkt nach `persistSession(jar, session);`:

```ts
  jar.set(SESSION_STARTED_AT, String(Math.floor(Date.now() / 1000)), SESSION_ABSOLUTE_MAX);
```

In `emporixRefresh`, als **erstes** nach `const jar = await sessionCookieJar();`:

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

`SESSION_STARTED_AT` und `SESSION_ABSOLUTE_MAX` oben importieren.

- [ ] **Step 6: Testlauf — muss durchlaufen**

```bash
pnpm -F @viu/emporix-sdk-next test -- session-auth
```

Erwartung: alle grün, 5 Tests mehr als nach H2.

- [ ] **Step 7: Mutation testen**

`persistSession` um `jar.set(SESSION_STARTED_AT, String(Math.floor(Date.now()/1000)), SESSION_ABSOLUTE_MAX)`
erweitern — also die Decke gleitend machen. Test «does not slide the ceiling
across repeated refreshes» **muss** rot werden. Danach zurückdrehen.

Ohne diese Mutation ist der Test die Behauptung, dass etwas nicht passiert, was
niemand programmiert hat — er beweist erst etwas, wenn er das Gegenteil fängt.

- [ ] **Step 8: Volle Suite, Typecheck, Commit**

```bash
pnpm -F @viu/emporix-sdk-next test && pnpm typecheck
```

```bash
git add packages/next/src packages/next/tests && git commit -m "feat(repo): cap the session at ninety days regardless of activity"
```

---

### Task H4: Doku, Changeset und Live-Verifikation

**Files:**
- Modify: `packages/next/README.md`
- Modify: `examples/next-server-first/.env.example`
- Modify: `examples/next-server-first/README.md`
- Create: `.changeset/next-session-hardening.md`

**Interfaces:**
- Consumes: alles aus H1-H3.
- Produces: nichts im Code.

- [ ] **Step 1: Changeset**

Erstelle `.changeset/next-session-hardening.md`:

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

- [ ] **Step 2: README-Abschnitt**

In `packages/next/README.md`, nach dem Abschnitt über den Server-First-Modus:

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

- [ ] **Step 3: Example-Konfiguration**

An `examples/next-server-first/.env.example` anhängen:

```
# Optional. Set to enable cookie encryption; generate with:
#   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
# EMPORIX_COOKIE_SECRET=
```

Und in `examples/next-server-first/README.md` eine Zeile in der Checkliste
«What each page proves», dass `/debug` auch mit gesetztem Secret grün bleibt.

- [ ] **Step 4: Volle Suite über alles**

```bash
pnpm -r --filter "./packages/*" build && pnpm -r test && pnpm typecheck && pnpm lint
```

Erwartung: alles grün. Die Testzahl notieren — geratene Zahlen waren in diesem
Repo schon dreimal falsch.

- [ ] **Step 5: Commit**

```bash
git add .changeset packages/next/README.md examples/next-server-first && git commit -m "docs(repo): document the session cookie hardening"
```

- [ ] **Step 6: Live-Verifikation ohne Secret**

```bash
pnpm -F @viu/emporix-examples-next-server-first build
```

Server starten, dann im Browser:

1. `/` → Produkt in den Warenkorb, `/cart` zeigt es.
2. In den DevTools: die Cookies heissen **ohne** `__Host-`-Präfix, weil
   localhost über http läuft. Werte im Klartext.
3. `/debug` ist grün.

- [ ] **Step 7: Live-Verifikation mit Secret**

Schlüssel erzeugen, in `.env.local` eintragen, Server neu starten.

1. `/cart` zeigt **«No cart yet»** — die alte Session ist ungültig, wie
   dokumentiert.
2. Neues Produkt in den Warenkorb.
3. In den DevTools: `emporix.cartId` beginnt mit `v1.` und enthält die Cart-Id
   nicht mehr im Klartext.
4. `/debug` ist grün.
5. Schlüssel in `.env.local` durch einen neuen ersetzen, Server neu starten →
   `/cart` sagt wieder «No cart yet». Das ist der Massen-Logout.

Punkt 5 ist der Beleg für die Fähigkeit, die das Feature eigentlich rechtfertigt.

- [ ] **Step 8: Den `saasToken` messen**

Offener Punkt 2 der Spec. Beim eingeloggten Lauf einmal die Länge des
`saasToken`-Cookies notieren. Verschlüsselt kostet er rund
`1.34 × (n + 28)` Bytes; ab etwa 2,9 KB Klartext reisst das 4-KB-Limit pro
Cookie. Passt es, in die README schreiben; passt es nicht, ist das ein Blocker
und gehört gemeldet, nicht umschifft.

Dieser Schritt braucht einen Login und damit die Hand der Nutzerin am
Passwortfeld.

- [ ] **Step 9: PR**

```bash
git push origin feat/session-hardening
```

PR gegen `main` öffnen. Beschreibung: die drei Massnahmen, der Befund zur nie
ablaufenden Session, die gemessene Testzahl, und ausdrücklich der Hinweis, dass
das Deployment alle ausloggt.

**Nicht mergen.** Das ist die Entscheidung der Nutzerin.

---

## Self-Review

**Spec-Abdeckung:**

| Spec-Abschnitt | Task |
|---|---|
| Absolute Obergrenze, 90 Tage | H3 |
| Stempel bei Login, Prüfung bei Refresh, Löschen bei Logout | H3 Steps 4-5 |
| `__Host-`-Präfix, an `secure` gekoppelt | H2 Steps 1-2 |
| Browserlesbare Cookies bleiben unpräfixt | H2 Step 5 |
| AES-256-GCM, `node:crypto`, synchron | H1 Step 3 |
| Schlüsselliste mit Rotation | H1 Step 3, Tests 5-6 |
| AAD = Cookie-Name | H1 Step 3, Test 4 |
| `v1.`-Präfix, kein Klartext-Fallback | H1 Step 3, Test 7 |
| Alle httpOnly-Cookies inkl. `customerTokenExpiresAt` | H2 Steps 2-4 |
| Migration loggt alle aus | H4 Steps 1-2, Live-Check Step 7 |
| Tests 1-16 der Spec | H1 Step 1 (1-8), H2 Step 6 (9-13), H3 Step 2 (14-16) |

**Nicht abgedeckt, bewusst:** die Nicht-Ziele der Spec — serverseitige Sessions,
Reuse-Detection, Änderungen am React-Package.

**Über die Spec hinaus, mit Grund:** die Spec nennt drei Lesestellen nicht
einzeln. Der Plan tut es, weil `token-proxy.ts` und `server-session.ts` den
Cookie-Jar **umgehen** — ohne H2 Steps 3-4 wäre die Verschlüsselung dort
wirkungslos und der Proxy würde jeden Wert für unlesbar halten. `proxy.ts`
bekommt einen eigenen Schritt, der sagt, dass es *nicht* angefasst wird.

**Typ-Konsistenz:** `cookieName`, `sealCookie`, `openCookie` werden in H2
definiert und in H2 Steps 2-4 mit genau diesen Signaturen konsumiert.
`clearSession` wird in H3 Step 4 definiert und in Step 5 genutzt.
`SESSION_STARTED_AT` und `SESSION_ABSOLUTE_MAX` kommen aus H3 Step 1.

**Eine Annahme, die H2 Step 6 prüft:** dass die bestehenden Tests in
`session-client.test.ts` ohne `x-forwarded-proto` laufen und damit unpräfixte
Namen erwarten. Der Schritt sagt, was zu tun ist, falls nicht — und ausdrücklich,
was nicht zu tun ist.
