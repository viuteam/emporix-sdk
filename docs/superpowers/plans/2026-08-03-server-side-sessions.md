# Serverseitige Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Session-Werte wandern in einen vom Consumer gestellten Store, im
Cookie bleibt eine opake `sid`. Damit wird der Widerruf einer **einzelnen**
Session möglich.

**Architecture:** Der Store ist eine *Implementierung* von `SessionCookieJar`,
kein zweiter Codepfad. `sessionCookieJar()` hydriert den Record einmal (async),
gibt einen synchronen Jar darüber zurück, und die vier Aufrufer flushen einmal.
Oberhalb des Jars ändert sich nichts.

**Tech Stack:** `node:crypto` für die `sid`, `redis` (node-redis) **nur** im
Example, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-03-server-side-sessions-design.md`

## Global Constraints

- **Branch:** `feat/session-store`, bereits von `main` gezogen (enthält den
  gemergten PR #197). Die Spec liegt schon drauf.
- **Push:** `git push origin feat/session-store` über SSH. Der gh-Token wird für
  Git-Operationen über HTTPS abgelehnt.
- **Commitlint:** Scope aus `repo, release, sdk, react, core, customer, product,
  category, cart, checkout, payment, price, media, segment, availability, auth,
  http, logger, deps, docs, examples`. Kein `next`-Scope — `repo` nehmen. Erstes
  Wort nach dem Scope ist ein **kleingeschriebenes Verb**.
- **Das Package behält null Runtime-Dependencies.** Es definiert das Interface,
  keine Implementierung. `redis` geht in `examples/next-server-first`.
- **Keine Signatur wird async, die es nicht schon ist.**
  `AnonymousSessionStore` ist synchron und wird mitten im Token-Refresh gerufen
  ([core/auth.ts:42-45](../../../packages/sdk/src/core/auth.ts#L42)).
- **Der Cookie-Modus bleibt unangetastet.** Ohne `store` muss sich alles
  verhalten wie heute, inklusive Verschlüsselung und `__Host-`-Präfix. Ein Test
  hält das fest.
- **`exactOptionalPropertyTypes` ist an.** Optionales Feld bekommt einen Wert
  oder existiert nicht.
- **Schweizer Hochdeutsch in Prosa, kein scharfes S.** Code und Kommentare
  englisch.
- **Redis läuft in Podman auf 6379**, mit `+PONG` verifiziert.

---

### Task S1: Interface, `sid` und der Store-Jar

**Files:**
- Create: `packages/next/src/session-store.ts`
- Modify: `packages/next/src/session-cookies.ts:83-105`
- Test: `packages/next/tests/session-store.test.ts` (neu)

**Interfaces:**
- Consumes: `cookieName`, `readCookie` aus `./cookie-name`.
- Produces:
  - `EmporixSessionStore` — `read`/`write`/`destroy`
  - `SESSION_SID` = `"emporix.sid"`
  - `SESSION_GUEST_MAX` = `7 * 24 * 60 * 60`
  - `hydrateStoreJar(store, secure, readOnly)` →
    `Promise<{ jar: SessionCookieJar; flush: () => Promise<void> }>`

- [ ] **Step 1: Den Testfile schreiben**

Erstelle `packages/next/tests/session-store.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

const bag = new Map<string, { name: string; value: string; opts?: Record<string, unknown> }>();
const jar = {
  get: (name: string) => bag.get(name),
  set: (name: string, value: string, opts?: Record<string, unknown>) => {
    bag.set(name, { name, value, ...(opts ? { opts } : {}) });
  },
  delete: (name: string) => {
    bag.delete(name);
  },
};
const headerBag = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve(jar),
  headers: () => Promise.resolve({ get: (k: string) => headerBag.get(k) ?? null }),
}));

const { sessionCookieJar } = await import("../src/session-cookies");
const { SESSION_SID } = await import("../src/session-store");
import type { EmporixSessionStore } from "../src/session-store";

/** A Map-backed store. Deliberately not exported from the package — a consumer
 *  who needs one for their own tests can write these fifteen lines. */
function fakeStore(): EmporixSessionStore & {
  records: Map<string, { record: Record<string, string>; ttl: number }>;
  reads: number;
} {
  const records = new Map<string, { record: Record<string, string>; ttl: number }>();
  const self = {
    records,
    reads: 0,
    read: async (id: string) => {
      self.reads += 1;
      return records.get(id)?.record ?? null;
    },
    write: async (id: string, record: Record<string, string>, ttl: number) => {
      records.set(id, { record: { ...record }, ttl });
    },
    destroy: async (id: string) => {
      records.delete(id);
    },
  };
  return self;
}

beforeEach(() => {
  bag.clear();
  headerBag.clear();
  headerBag.set("x-forwarded-proto", "https");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cookie mode is untouched", () => {
  it("writes values into cookies when no store is configured", async () => {
    const j = await sessionCookieJar();
    j.set("emporix.customerToken", "tok-1", 3600);
    await j.flush();
    expect(bag.get("__Host-emporix.customerToken")?.value).toBe("tok-1");
    expect(bag.get("__Host-emporix.sid")).toBeUndefined();
  });
});

describe("store mode", () => {
  it("puts only the sid in a cookie, never the token", async () => {
    const store = fakeStore();
    const j = await sessionCookieJar({ store });
    j.set("emporix.customerToken", "tok-1", 3600);
    await j.flush();
    const sid = bag.get(`__Host-${SESSION_SID}`);
    expect(sid).toBeDefined();
    expect(bag.get("__Host-emporix.customerToken")).toBeUndefined();
    for (const c of bag.values()) expect(c.value).not.toContain("tok-1");
  });

  it("marks the sid httpOnly", async () => {
    const store = fakeStore();
    const j = await sessionCookieJar({ store });
    j.set("emporix.customerToken", "tok-1", 3600);
    await j.flush();
    expect(bag.get(`__Host-${SESSION_SID}`)?.opts).toMatchObject({ httpOnly: true });
  });

  it("reads a value back on a second request with the same sid", async () => {
    const store = fakeStore();
    const first = await sessionCookieJar({ store });
    first.set("emporix.customerToken", "tok-1", 3600);
    await first.flush();

    const second = await sessionCookieJar({ store });
    expect(second.get("emporix.customerToken")).toBe("tok-1");
  });

  it("treats an unknown sid as an empty session, not an error", async () => {
    const store = fakeStore();
    bag.set(`__Host-${SESSION_SID}`, { name: `__Host-${SESSION_SID}`, value: "never-existed" });
    const j = await sessionCookieJar({ store });
    expect(j.get("emporix.customerToken")).toBeNull();
  });

  it("survives a store whose read throws", async () => {
    // A Redis outage must degrade to «logged out», not to a 500 on every page.
    const store = fakeStore();
    store.read = async () => {
      throw new Error("connection refused");
    };
    bag.set(`__Host-${SESSION_SID}`, { name: `__Host-${SESSION_SID}`, value: "some-id" });
    const j = await sessionCookieJar({ store });
    expect(j.get("emporix.customerToken")).toBeNull();
  });

  it("keeps siteCode a cookie even in store mode", async () => {
    // The site proxy writes it browser-readable on purpose.
    const store = fakeStore();
    const j = await sessionCookieJar({ store });
    j.set("emporix.siteCode", "main", 3600);
    await j.flush();
    expect(bag.get("__Host-emporix.siteCode")?.value).toBe("main");
    expect(store.records.size).toBe(0);
  });

  it("does not write in the read-only variant", async () => {
    // Next forbids a cookie write during render, but nothing stops a store
    // write — the mistake would be invisible and would move real state.
    const store = fakeStore();
    const j = await sessionCookieJar({ store, readOnly: true });
    j.set("emporix.customerToken", "tok-1", 3600);
    await j.flush();
    expect(store.records.size).toBe(0);
  });

  it("deletes a value from the record", async () => {
    const store = fakeStore();
    const first = await sessionCookieJar({ store });
    first.set("emporix.customerToken", "tok-1", 3600);
    await first.flush();

    const second = await sessionCookieJar({ store });
    second.delete("emporix.customerToken");
    await second.flush();

    const third = await sessionCookieJar({ store });
    expect(third.get("emporix.customerToken")).toBeNull();
  });

  it("does not touch the store when nothing changed", async () => {
    const store = fakeStore();
    const j = await sessionCookieJar({ store });
    await j.flush();
    expect(store.records.size).toBe(0);
  });
});

describe("lifetimes", () => {
  it("gives a guest session the sliding guest window", async () => {
    const store = fakeStore();
    const j = await sessionCookieJar({ store });
    j.set("emporix.anonymousSession", '{"refreshToken":"r","sessionId":"s"}', 3600);
    await j.flush();
    const [entry] = [...store.records.values()];
    expect(entry?.ttl).toBe(7 * 24 * 60 * 60);
  });

  it("gives a customer session the time left until the ceiling", async () => {
    const store = fakeStore();
    const j = await sessionCookieJar({ store });
    const tenDaysAgo = Math.floor(Date.now() / 1000) - 10 * 24 * 60 * 60;
    j.set("emporix.customerToken", "tok-1", 3600);
    j.set("emporix.sessionStartedAt", String(tenDaysAgo), 3600);
    await j.flush();
    const [entry] = [...store.records.values()];
    // 90 days minus the 10 already spent, give or take a second of test runtime.
    expect(entry?.ttl).toBeGreaterThan(79 * 24 * 60 * 60);
    expect(entry?.ttl).toBeLessThanOrEqual(80 * 24 * 60 * 60);
  });
});
```

- [ ] **Step 2: Testlauf — muss fehlschlagen**

```bash
pnpm -F @viu/emporix-sdk-next test -- session-store
```

Erwartung: Import von `../src/session-store` schlägt fehl. Notiere die Testzahl
**vor** dieser Task.

- [ ] **Step 3: Das Store-Modul schreiben**

Erstelle `packages/next/src/session-store.ts`:

```ts
import { randomBytes } from "node:crypto";
import { STORAGE_KEYS } from "@viu/emporix-sdk-react/ssr";
import { SESSION_ABSOLUTE_MAX, SESSION_STARTED_AT } from "./session-cookies";

/**
 * A place to keep session values so the browser never holds them.
 *
 * The package ships no implementation on purpose — that is what keeps it at zero
 * runtime dependencies. `examples/next-server-first` has a Redis one to copy.
 *
 * Three methods, because a fourth would be something to get wrong. `write`
 * REPLACES the record rather than merging: a merge needs conflict rules for two
 * concurrent requests, and last-writer-wins is the right semantics for session
 * state anyway.
 */
export interface EmporixSessionStore {
  /** The record, or `null` when the id is unknown or expired. */
  read(id: string): Promise<Record<string, string> | null>;
  /** Replaces the record and sets its expiry. */
  write(id: string, record: Record<string, string>, ttlSeconds: number): Promise<void>;
  /** Removes the record. Must not throw when the id is unknown. */
  destroy(id: string): Promise<void>;
}

/** The only session cookie in store mode. */
export const SESSION_SID = "emporix.sid";

/**
 * How long a guest session lives, sliding.
 *
 * An anonymous session guards no account, so there is no reason for a hard
 * ceiling. What bounds the guest experience is Emporix's refresh token, not
 * this: the anonymous access token is valid for one hour and is renewed from
 * the refresh token.
 *
 * Seven rather than the thirty days the cookie mode uses, because in store mode
 * every visitor costs a key. With bot traffic that is a real operational line
 * item and this is the cheapest lever against it.
 */
export const SESSION_GUEST_MAX = 7 * 24 * 60 * 60;

/** Values that stay cookies even in store mode: the site proxy writes them
 *  browser-readable on purpose, and moving them would break a client-side
 *  language switch. */
const PUBLIC_KEYS: readonly string[] = [STORAGE_KEYS.siteCode, STORAGE_KEYS.language];

export function isPublicSessionKey(name: string): boolean {
  return PUBLIC_KEYS.includes(name);
}

/** 32 random bytes. Not encrypted: sealing a random id buys nothing, because it
 *  already means nothing without the store. */
export function newSessionId(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The remaining lifetime for a record, in seconds.
 *
 * The TTL is time-remaining rather than a fixed window, so the key dies exactly
 * when the session does and a sliding TTL cannot outlive a non-sliding ceiling.
 */
export function recordTtl(record: Record<string, string>): number {
  const hasCustomer = record[STORAGE_KEYS.customerToken] !== undefined;
  if (!hasCustomer) return SESSION_GUEST_MAX;
  const startedAt = Number(record[SESSION_STARTED_AT]);
  if (!Number.isFinite(startedAt)) return SESSION_ABSOLUTE_MAX;
  const spent = Math.floor(Date.now() / 1000) - startedAt;
  return Math.max(1, SESSION_ABSOLUTE_MAX - spent);
}
```

`Number(undefined)` ist `NaN`, deshalb genügt hier `Number.isFinite` — anders als
bei `jar.get()`, das `null` liefert, wo `Number(null)` **0** ergibt. Der
Unterschied hat in der Härtung schon einmal einen Fehler verursacht.

- [ ] **Step 4: Den Jar um den Store erweitern**

In `packages/next/src/session-cookies.ts`, `SessionCookieJar` um `flush`
ergänzen und `sessionCookieJar` umbauen.

Zuerst das Interface:

```ts
export interface SessionCookieJar {
  get(name: string): string | null;
  /** No-op when the jar is read-only (a Server Component render). */
  set(name: string, value: string, maxAgeSeconds: number): void;
  /** No-op when the jar is read-only. */
  delete(name: string): void;
  /**
   * Persists a store-backed session. A no-op in cookie mode, where `set` has
   * already written through.
   *
   * Must be awaited by every mutating entry point. The read-only variant never
   * needs it, which halves the places that could forget.
   */
  flush(): Promise<void>;
  /** Drops the whole session, store record included. */
  destroy(): Promise<void>;
}
```

Dann die Funktion:

```ts
export async function sessionCookieJar(
  opts: { readOnly?: boolean; store?: EmporixSessionStore } = {},
): Promise<SessionCookieJar> {
  const jar = await cookies();
  const readOnly = opts.readOnly ?? false;
  const secure = await isSecure();
  const store = opts.store;

  const cookieGet = (name: string): string | null =>
    readCookie(name, (wire) => jar.get(wire)?.value);
  const cookieSet = (name: string, value: string, maxAgeSeconds: number): void => {
    jar.set(cookieName(name, secure), sealCookie(name, value), {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: maxAgeSeconds,
    });
  };

  if (store === undefined) {
    return {
      get: cookieGet,
      set: (name, value, maxAgeSeconds) => {
        if (readOnly) return;
        cookieSet(name, value, maxAgeSeconds);
      },
      delete: (name) => {
        if (readOnly) return;
        jar.delete(cookieName(name, secure));
      },
      flush: async () => {},
      destroy: async () => {},
    };
  }

  // Store mode: hydrate once, mutate in memory, flush once. This is what lets a
  // synchronous jar sit on top of an async store — and AnonymousSessionStore
  // (sdk core/auth.ts:42) leaves no choice, it is declared synchronous.
  const sid = cookieGet(SESSION_SID);
  let record: Record<string, string> = {};
  if (sid !== null) {
    try {
      record = (await store.read(sid)) ?? {};
    } catch {
      // A store outage degrades to «logged out», not to a 500 on every page.
      record = {};
    }
  }
  let dirty = false;

  return {
    get: (name) => (isPublicSessionKey(name) ? cookieGet(name) : (record[name] ?? null)),
    set: (name, value, maxAgeSeconds) => {
      if (readOnly) return;
      if (isPublicSessionKey(name)) {
        cookieSet(name, value, maxAgeSeconds);
        return;
      }
      record[name] = value;
      dirty = true;
    },
    delete: (name) => {
      if (readOnly) return;
      if (isPublicSessionKey(name)) {
        jar.delete(cookieName(name, secure));
        return;
      }
      if (record[name] !== undefined) {
        delete record[name];
        dirty = true;
      }
    },
    flush: async () => {
      if (readOnly || !dirty) return;
      const id = sid ?? newSessionId();
      const ttl = recordTtl(record);
      await store.write(id, record, ttl);
      cookieSet(SESSION_SID, id, ttl);
      dirty = false;
    },
    destroy: async () => {
      if (readOnly) return;
      if (sid !== null) await store.destroy(sid);
      jar.delete(cookieName(SESSION_SID, secure));
      record = {};
      dirty = false;
    },
  };
}
```

Imports oben ergänzen:

```ts
import {
  isPublicSessionKey,
  newSessionId,
  recordTtl,
  SESSION_SID,
  type EmporixSessionStore,
} from "./session-store";
```

**Achtung Zyklus:** `session-store.ts` importiert `SESSION_ABSOLUTE_MAX` und
`SESSION_STARTED_AT` aus `session-cookies.ts`, und `session-cookies.ts`
importiert Funktionen zurück. Das sind reine Konstanten in einer Richtung und
Funktionen in der anderen, ESM löst das auf — aber wenn der Build sich
beschwert, wandern die zwei Konstanten in `session-store.ts` und
`session-cookies.ts` re-exportiert sie. **Nicht** mit einer dritten Datei
auflösen, bevor der Zyklus tatsächlich stört.

- [ ] **Step 5: Testlauf — muss durchlaufen**

```bash
pnpm -F @viu/emporix-sdk-next test -- session-store
```

Erwartung: 12 Tests grün. Die anderen Suites laufen noch nicht, weil `flush`
neu im Interface ist — das ist Step 6.

- [ ] **Step 6: Die vier Aufrufer flushen lassen**

`pnpm -F @viu/emporix-sdk-next typecheck` zeigt jetzt, wo `flush` fehlt. In
`session-auth.ts`:

- `emporixLogin`: nach `jar.delete(STORAGE_KEYS.anonymousSession);` ein
  `await jar.flush();`
- `emporixRefresh`: nach `persistSession(jar, session);` ein
  `await jar.flush();` — **und** im Decken-Zweig nach `clearSession(jar)` ein
  `await jar.destroy();`
- `emporixLogout`: nach `clearSession(jar);` ein `await jar.destroy();`

In `session-client.ts`, `run()`: die mutable Variante muss nach `fn` flushen.
Das braucht eine kleine Umstellung, weil `run` heute direkt `return fn(...)`:

```ts
  const result = await fn(client, auth.anonymous());
  if (!readOnly) await jar.flush();
  return result;
```

— an **beiden** Rückgabestellen, dem Customer- und dem Guest-Zweig.

- [ ] **Step 7: Volle Suite und Typecheck**

```bash
pnpm -F @viu/emporix-sdk-next test && pnpm -F @viu/emporix-sdk-next typecheck
```

Erwartung: alles grün. Falls bestehende Tests brechen, weil sie einen Jar
selbst bauen und `flush` fehlt: den Test anpassen, nicht das Interface optional
machen — ein optionales `flush` ist genau die Stelle, die jemand vergisst.

- [ ] **Step 8: Mutation testen**

Drei Mutationen, jede einzeln, jeweils zurückdrehen:

1. In `flush` das `if (readOnly …) return;` entfernen → «does not write in the
   read-only variant» **muss** rot werden. Das ist der wertvollste Test der
   Task: Next verhindert Cookie-Writes im Render, einen Store-Write aber nicht.
2. `isPublicSessionKey` immer `false` zurückgeben lassen → «keeps siteCode a
   cookie even in store mode» **muss** rot werden.
3. In `recordTtl` die Restzeit-Rechnung durch `SESSION_ABSOLUTE_MAX` ersetzen →
   «gives a customer session the time left until the ceiling» **muss** rot
   werden.

- [ ] **Step 9: Commit**

```bash
git add packages/next/src packages/next/tests && git commit -m "feat(repo): add a session store adapter behind the cookie jar"
```

---

### Task S2: Die drei Leser und der Entry

**Files:**
- Modify: `packages/next/src/session-client.ts:11-25` (Options)
- Modify: `packages/next/src/token-proxy.ts:50-80`
- Modify: `packages/next/src/server-session.ts:51-97`
- Modify: `packages/next/src/session.ts` (Export)
- Test: `packages/next/tests/session-store.test.ts` (ergänzen)

**Interfaces:**
- Consumes: alles aus S1.
- Produces:
  - `store?: EmporixSessionStore` in `WithEmporixSessionOptions`
  - `store?` in `EmporixTokenProxyOptions` und in den Optionen von
    `emporixSession` / `emporixSessionMutable`
  - `EmporixSessionStore` und `SESSION_SID` aus `@viu/emporix-sdk-next/session`

- [ ] **Step 1: Die Option in `WithEmporixSessionOptions`**

```ts
  /**
   * Keeps session values server-side instead of in cookies. Without it the
   * values live in cookies, which still works — see the README.
   */
  store?: EmporixSessionStore;
```

Und in `run()` weiterreichen:

```ts
  const jar = await sessionCookieJar({
    readOnly,
    ...(opts.store !== undefined ? { store: opts.store } : {}),
  });
```

Das `...(x !== undefined ? …)` ist wegen `exactOptionalPropertyTypes` nötig, nicht
Stilfrage.

- [ ] **Step 2: `emporixTokenProxy`**

Der Proxy liest heute `request.cookies` direkt. Im Store-Modus steht dort nur
eine `sid`, also braucht er den Store. Er kann nicht `sessionCookieJar()`
nutzen, weil `cookies()` in einem Proxy nicht existiert — er liest die `sid`
selbst und geht dann an den Store.

`EmporixTokenProxyOptions` bekommt `store?: EmporixSessionStore`, und der Block
ab `const read = …` wird:

```ts
  const read = (wire: string): string | undefined => request.cookies.get(wire)?.value;
  let token: string | null;
  let expiryRaw: string | null;
  if (opts.store !== undefined) {
    const sid = readCookie(SESSION_SID, read);
    const record = sid === null ? null : await opts.store.read(sid).catch(() => null);
    token = record?.[STORAGE_KEYS.customerToken] ?? null;
    expiryRaw = record?.[SESSION_EXPIRES_AT] ?? null;
  } else {
    token = readCookie(STORAGE_KEYS.customerToken, read);
    expiryRaw = readCookie(SESSION_EXPIRES_AT, read);
  }
```

Und im `stale`-Zweig: der Cookie-Write der frischen Token entfällt im
Store-Modus, weil `emporixRefresh` schon in den Store geschrieben hat und der
folgende Render von dort liest:

```ts
      const fresh = await emporixRefresh(refreshOpts);
      if (fresh !== null && opts.store === undefined) {
        // Cookie mode only: make the fresh token visible to THIS render. In
        // store mode emporixRefresh already wrote the record, and the render
        // reads the record — there is nothing to inject.
        request.cookies.set(tokenCookie, sealCookie(STORAGE_KEYS.customerToken, fresh));
      }
```

`emporixRefresh` braucht den Store ebenfalls, sonst refresht der Proxy gegen
Cookies:

```ts
  const refreshOpts: WithEmporixSessionOptions =
    opts.store !== undefined ? { store: opts.store } : {};
```

- [ ] **Step 3: `emporixSession` und `emporixSessionMutable`**

Beide bauen einen `ServerCookieJar`-Shim über `cookies()`. Im Store-Modus muss
der Shim über den Session-Jar gehen.

`emporixSession` bekommt einen optionalen Parameter:

```ts
export async function emporixSession(
  opts: { store?: EmporixSessionStore } = {},
): Promise<EmporixServerSession> {
  const sessionJar = await sessionCookieJar({
    readOnly: true,
    ...(opts.store !== undefined ? { store: opts.store } : {}),
  });
  const io: ServerCookieJar = { get: (name) => sessionJar.get(name) };
  return build(createServerStorage(io));
}
```

Das ist zugleich eine Vereinfachung: die eigene `readCookie`-Verdrahtung fällt
weg, weil der Jar sie schon macht.

`emporixSessionMutable` analog, plus `store` in seinem Options-Objekt und ein
`await sessionJar.flush()` **nach** dem Aufbau — hier ist die Reihenfolge
tückisch, weil `createServerStorage` synchron schreibt. Der Shim sammelt also im
Jar, und der Aufrufer bekommt die Session zurück, bevor geflusht wurde. Deshalb:

```ts
  // The storage writes synchronously into the jar; the flush has to happen
  // after the caller is done with it. Returning a `flush` on the session is the
  // honest shape — a silent write-behind would be a lie about when state lands.
  return { ...build(createServerStorage(io)), flush: () => sessionJar.flush() };
```

`EmporixServerSession` bekommt dafür `flush: () => Promise<void>`. In der
read-only Variante ist es eine No-op, damit beide dieselbe Form haben.

- [ ] **Step 4: Aus dem Entry exportieren**

In `packages/next/src/session.ts`:

```ts
export {
  SESSION_GUEST_MAX,
  SESSION_SID,
  type EmporixSessionStore,
} from "./session-store";
```

- [ ] **Step 5: Tests für die drei Leser**

An `session-store.test.ts` anhängen — `emporixSession` und `withEmporixSession`
gegen den Fake-Store, plus der Proxy:

```ts
describe("all three readers see the store", () => {
  it("emporixSession reads the session out of the store", async () => {
    const store = fakeStore();
    const seed = await sessionCookieJar({ store });
    seed.set("emporix.customerToken", "tok-1", 3600);
    seed.set("emporix.cartId", "cart-1", 3600);
    await seed.flush();

    const { emporixSession } = await import("../src/server-session");
    const session = await emporixSession({ store });
    expect(session.customerToken).toBe("tok-1");
    expect(session.cartId).toBe("cart-1");
  });

  it("withEmporixSession resolves a customer context from the store", async () => {
    const store = fakeStore();
    const seed = await sessionCookieJar({ store });
    seed.set("emporix.customerToken", "tok-1", 3600);
    await seed.flush();

    process.env.EMPORIX_TENANT = "viu";
    process.env.EMPORIX_STOREFRONT_CLIENT_ID = "sf";
    const { withEmporixSession } = await import("../src/session-client");
    const ctx = await withEmporixSession(async (_c, c) => c, { store });
    expect(ctx).toEqual({ kind: "customer", token: "tok-1" });
    delete process.env.EMPORIX_TENANT;
    delete process.env.EMPORIX_STOREFRONT_CLIENT_ID;
  });
});
```

Für den Proxy einen Test in `token-proxy.test.ts` ergänzen, der belegt, dass er
mit `store` **nicht** aus dem Cookie liest:

```ts
  it("reads the token from the store when one is configured", async () => {
    const records = new Map([["sid-1", { [TOKEN]: OPAQUE, [EXPIRES]: expiresIn(30) }]]);
    const store = {
      read: async (id: string) => records.get(id) ?? null,
      write: async () => {},
      destroy: async () => {},
    };
    const request = new NextRequest("https://shop.test/", {
      headers: { cookie: `__Host-emporix.sid=sid-1` },
    });
    await emporixTokenProxy(request, { store });
    // The expiry in the record is inside the skew window, so it refreshed —
    // which proves it read the record, since the cookie holds no token at all.
    expect(refreshCalls).toHaveLength(1);
  });
```

- [ ] **Step 6: Volle Suite, Typecheck, Lint**

```bash
pnpm -F @viu/emporix-sdk-next test && pnpm -F @viu/emporix-sdk-next typecheck && pnpm -F @viu/emporix-sdk-next lint
```

- [ ] **Step 7: Mutation testen**

In `emporixTokenProxy` den Store-Zweig entfernen, sodass immer aus Cookies
gelesen wird → «reads the token from the store when one is configured» **muss**
rot werden. Ohne diese Mutation beweist der Test nichts, weil ein
`refreshCalls`-Zähler auch bei einem fehlenden Token null bleibt — er könnte aus
dem falschen Grund grün sein.

- [ ] **Step 8: Commit**

```bash
git add packages/next/src packages/next/tests && git commit -m "feat(repo): thread the session store through all three readers"
```

---

### Task S3: Redis-Adapter im Example und Live-Verifikation

**Files:**
- Create: `examples/next-server-first/app/session-store.ts`
- Modify: `examples/next-server-first/app/emporix.ts`
- Modify: `examples/next-server-first/proxy.ts`
- Modify: `examples/next-server-first/app/cart/page.tsx`, `app/checkout/page.tsx`,
  `app/actions/cart.ts`, `app/actions/checkout.ts`, `app/login/page.tsx`,
  `app/debug/page.tsx` — überall wo `EMPORIX` oder `emporixSession` genutzt wird
- Modify: `examples/next-server-first/package.json` (`redis`)

**Interfaces:**
- Consumes: `EmporixSessionStore` aus `@viu/emporix-sdk-next/session`.
- Produces: `sessionStore(): EmporixSessionStore | undefined`.

- [ ] **Step 1: `redis` als Dependency**

```bash
pnpm -F @viu/emporix-examples-next-server-first add redis
```

Das Package selbst bekommt **nichts** — die Null-Dependency-Zusage gilt.

- [ ] **Step 2: Den Adapter schreiben**

Erstelle `examples/next-server-first/app/session-store.ts`:

```ts
import { createClient, type RedisClientType } from "redis";
import type { EmporixSessionStore } from "@viu/emporix-sdk-next/session";

const PREFIX = "emporix:session:";

let client: RedisClientType | undefined;

/**
 * Memoized like getEmporixClient. A module-level connection would leak one
 * socket per HMR reload in dev.
 */
function connection(url: string): RedisClientType {
  if (client === undefined) {
    client = createClient({ url });
    // Without this a transient error becomes an unhandled rejection that takes
    // the whole server down.
    client.on("error", (e) => console.error("[redis]", e));
  }
  return client;
}

async function ready(url: string): Promise<RedisClientType> {
  const c = connection(url);
  if (!c.isOpen) await c.connect();
  return c;
}

/**
 * A Redis-backed session store, or `undefined` when no URL is configured.
 *
 * Returning `undefined` rather than throwing is what keeps both modes
 * reachable: drop the variable and the example runs on cookies, no code change.
 */
export function sessionStore(): EmporixSessionStore | undefined {
  const url = process.env.EMPORIX_SESSION_REDIS_URL;
  if (url === undefined || url.length === 0) return undefined;
  return {
    read: async (id) => {
      const raw = await (await ready(url)).get(PREFIX + id);
      return raw === null ? null : (JSON.parse(raw) as Record<string, string>);
    },
    write: async (id, record, ttlSeconds) => {
      await (await ready(url)).set(PREFIX + id, JSON.stringify(record), { EX: ttlSeconds });
    },
    destroy: async (id) => {
      await (await ready(url)).del(PREFIX + id);
    },
  };
}
```

- [ ] **Step 3: In `app/emporix.ts` verdrahten**

```ts
import { sessionStore } from "./session-store";

const STORE = sessionStore();

export const EMPORIX: WithEmporixSessionOptions = {
  context: CONTEXT,
  ...(STORE !== undefined ? { store: STORE } : {}),
};

/** Exported separately for the proxy and for emporixSession, which take their
 *  own options rather than the full WithEmporixSessionOptions. */
export const SESSION_STORE = STORE;
```

- [ ] **Step 4: Proxy und die direkten `emporixSession`-Aufrufe**

`examples/next-server-first/proxy.ts`:

```ts
return emporixTokenProxy(request, {
  site: { siteCode: "main" },
  ...(SESSION_STORE !== undefined ? { store: SESSION_STORE } : {}),
});
```

Es gibt genau **einen** `emporixSession()`-Aufruf im Example, gemessen:
`app/login/page.tsx:5`. Er bekommt den Store mit:

```ts
const { customerToken } = await emporixSession(
  SESSION_STORE !== undefined ? { store: SESSION_STORE } : {},
);
```

Vor dem Umbau nachzählen, ob es noch einer ist:

```bash
grep -rn "emporixSession(" examples/next-server-first/app
```

- [ ] **Step 5: Typecheck und Build**

```bash
pnpm -F @viu/emporix-sdk-next build && pnpm -F @viu/emporix-examples-next-server-first typecheck && pnpm -F @viu/emporix-examples-next-server-first build
```

- [ ] **Step 6: Live — Cookie-Modus muss unverändert laufen**

Ohne `EMPORIX_SESSION_REDIS_URL` starten. Warenkorb füllen, `/cart` zeigt ihn,
`/debug` grün. **Das ist der Regressionsbeleg**, dass der Cookie-Modus die
Arbeit überlebt hat.

- [ ] **Step 7: Live — Store-Modus gegen Redis**

Redis läuft in Podman auf 6379. Server mit
`EMPORIX_SESSION_REDIS_URL=redis://127.0.0.1:6379` neu starten.

1. `/cart` sagt **«No cart yet»** — die Cookie-Session gilt im Store-Modus nicht.
2. Warenkorb füllen, `/cart` zeigt ihn.
3. Im Browser sind **nur** `__Host-emporix.sid` und `emporix.siteCode` gesetzt.
4. Genau **ein** Key im Store:
   ```bash
   node -e "const {createClient}=require('redis');(async()=>{const c=createClient({url:'redis://127.0.0.1:6379'});await c.connect();console.log(await c.keys('emporix:session:*'));await c.quit();})()"
   ```
5. TTL bei ~604800 Sekunden (7 Tage) für den Gast.
6. Den Key löschen → `/cart` sagt wieder «No cart yet». **Das ist der Widerruf
   einer einzelnen Session, live** — die Fähigkeit, für die diese ganze Arbeit
   existiert.
7. `/debug` bleibt grün.

Punkt 6 ist der eigentliche Beleg. Punkte 1 und 3 belegen, dass nichts
Geheimes mehr im Browser liegt.

- [ ] **Step 8: Live — eingeloggt**

Braucht das Passwort und damit die Hand der Nutzerin. Danach prüfen:

1. TTL des Keys liegt bei ~90 Tagen statt 7.
2. Der Record enthält `emporix.saasToken`, der Browser nicht — damit ist
   zugleich der offene Punkt zur `saasToken`-Grösse gegenstandslos.

- [ ] **Step 9: Commit**

```bash
git add examples/next-server-first && git commit -m "feat(examples): add a redis session store to the next demo"
```

---

### Task S4: Doku, Changeset und PR

**Files:**
- Modify: `packages/next/README.md`
- Modify: `examples/next-server-first/README.md`
- Modify: `docs/superpowers/specs/2026-08-03-session-cookie-hardening-design.md`
  (die zwei offenen Punkte schliessen)
- Create: `.changeset/next-session-store.md`

- [ ] **Step 1: Changeset**

Erstelle `.changeset/next-session-store.md`:

```markdown
---
"@viu/emporix-sdk-next": minor
---

Session values can now live in a store you provide instead of in cookies. Pass
`store` and the browser keeps one opaque `emporix.sid`; everything else moves
server-side.

```ts
const store: EmporixSessionStore = {
  read: async (id) => …,
  write: async (id, record, ttlSeconds) => …,
  destroy: async (id) => …,
};
```

Three methods, and the package ships no implementation — that is what keeps it
at zero runtime dependencies. `examples/next-server-first` has a Redis one to
copy.

**What this buys that encrypted cookies cannot:** deleting a single session.
`emporixLogout` now destroys the record, and an operator with the id can too.

It also removes three problems rather than mitigating them: the 4 KB per-cookie
limit no longer applies to the `saasToken`, its JWT payload never reaches the
browser, and `cartId` / `activeLegalEntityId` — the values the app itself trusts
— are not in the browser to tamper with.

Lifetimes are time-remaining, so a key dies exactly when its session does:
`SESSION_ABSOLUTE_MAX` minus time spent for a customer, a sliding
`SESSION_GUEST_MAX` (7 days) for a guest. Guests get a shorter window because in
store mode every visitor costs a key.

**`EMPORIX_COOKIE_SECRET` is not applied in store mode.** Sealing a random id
buys nothing. The cookie mode keeps encryption unchanged.

**No admin API.** The store makes revocation possible; it is not shipped as a
feature. Revoking every session of one customer needs a `customerId → sid[]`
index, which your store can build from the record.
```

- [ ] **Step 2: README-Abschnitt im Package**

Nach «Session cookie hardening» ein Abschnitt «Server-side sessions» mit: dem
Interface, der Verdrahtung über `store`, der Tabelle was im Cookie bleibt, den
Lebensdauern, dem Satz zu `EMPORIX_COOKIE_SECRET`, und dem ehrlichen Absatz
über den Widerruf ohne Admin-API.

Dazu ausdrücklich: **alle drei Leser brauchen die Option** —
`withEmporixSession*`, `emporixTokenProxy` und `emporixSession`. Wer sie
irgendwo vergisst, bekommt dort still den Cookie-Modus, und das ist genau der
Fehler, den die Cookie-Härtung schon einmal produziert hat.

- [ ] **Step 3: Die zwei offenen Punkte der Härtungs-Spec schliessen**

In `2026-08-03-session-cookie-hardening-design.md` die offenen Punkte zur
`saasToken`-Grösse und zum JWT-Inhalt als **gegenstandslos im Store-Modus**
markieren, mit Verweis auf die neue Spec. Im Cookie-Modus bleiben sie offen.

- [ ] **Step 4: Volle Suite**

```bash
pnpm -r --filter "./packages/*" build && pnpm -r test && pnpm typecheck && pnpm lint
```

Testzahl notieren.

- [ ] **Step 5: Commit, Push, PR**

```bash
git add .changeset packages/next/README.md examples/next-server-first/README.md docs && git commit -m "docs(repo): document the server-side session store"
git push origin feat/session-store
```

PR gegen `main`. In die Beschreibung: die drei Massnahmen, was der Store kann
was Verschlüsselung nicht kann, die geschlossenen offenen Punkte, die gemessene
Testzahl, und der Live-Beleg für den Einzel-Widerruf.

**Nicht mergen.**

---

## Self-Review

**Spec-Abdeckung:**

| Spec-Abschnitt | Task |
|---|---|
| Hydrieren / im Speicher ändern / flushen | S1 Step 4 |
| Vier Flush-Stellen, read-only flusht nie | S1 Step 6, Test 9 |
| Adapter mit drei Methoden, `write` ersetzt | S1 Step 3 |
| `store` in `WithEmporixSessionOptions` | S2 Step 1 |
| `emporixTokenProxy` und `emporixSession` bekommen ihn | S2 Steps 2-3 |
| `emporix.sid`, 32 Bytes, httpOnly, `__Host-` | S1 Step 3-4, Tests 2-3 |
| `siteCode`/`language` bleiben Cookies | S1 Step 3, Test 8 |
| `EMPORIX_COOKIE_SECRET` nicht auf die `sid` | S1 Step 3 (`newSessionId` ohne Seal), S4 Steps 1-2 |
| TTL = Restzeit, Gast 7 Tage gleitend | S1 Step 3 (`recordTtl`), Tests 11-12 |
| Kein Index, kein Store im Package, kein Merge | Nicht-Ziele, S4 Step 1 |
| Redis-Adapter im Example, `undefined` ohne URL | S3 Steps 2-3 |
| Live-Checks inkl. Einzel-Widerruf | S3 Steps 6-8 |

**Über die Spec hinaus, mit Grund:** die Spec nennt `flush` und `destroy` nicht
als Teil des `SessionCookieJar`-Interface. Der Plan tut es, weil es sonst keinen
Ort gibt, an dem der Store-Write passiert — und `EmporixServerSession` bekommt
ebenfalls ein `flush`, weil `createServerStorage` synchron schreibt und der
Aufrufer entscheiden muss, wann der Zustand landet. Ein stilles Write-behind
wäre eine Lüge darüber, wann geschrieben wurde.

**Typ-Konsistenz:** `EmporixSessionStore`, `SESSION_SID`, `SESSION_GUEST_MAX`,
`newSessionId`, `recordTtl`, `isPublicSessionKey` entstehen in S1 Step 3 und
werden in S1 Step 4, S2 und S3 mit genau diesen Signaturen konsumiert. `flush`
und `destroy` kommen aus S1 Step 4 und werden in S1 Step 6 und S2 Step 3
gerufen.

**Drei Annahmen, die der Plan als Prüfpunkt markiert statt zu behaupten:**

1. Der Import-Zyklus zwischen `session-store.ts` und `session-cookies.ts` (S1
   Step 4) — mit der Anweisung, was zu tun ist, falls der Build sich beschwert,
   und ausdrücklich, was **nicht** zu tun ist.
2. Ob bestehende Tests brechen, weil sie einen Jar selbst bauen (S1 Step 7) —
   mit der Anweisung, den Test anzupassen und `flush` nicht optional zu machen.
3. Die Zahl der `emporixSession()`-Aufrufe im Example ist **einer**, gemessen
   (`app/login/page.tsx:5`) — mit einem Nachzähl-Befehl, falls sich das bis zur
   Umsetzung ändert.
