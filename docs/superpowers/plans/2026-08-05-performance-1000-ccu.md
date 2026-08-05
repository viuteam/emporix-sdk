# 1'000-CCU-Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die drei Code-Befunde aus der 1'000-CCU-Analyse beheben, die bei diesem Lastprofil zuerst greifen — Session-Read-Verstärkung, nicht gecachte Public-Route, Session-Read im TTFB-Pfad — plus die HTTP-Timeouts konfigurierbar machen.

**Architecture:** Drei der vier Fixes liegen im `@viu/emporix-sdk-next`-Package, damit jeder Konsument sie bekommt und nicht nur das Beispiel. Das Per-Request-Memo benutzt eine `WeakMap`, verankert am request-scoped Objekt aus `await cookies()` — kein `react`-Import, damit die in [#216](https://github.com/viuteam/emporix-sdk/pull/216) entfernte React-Abhängigkeit entfernt bleibt. Nur **read-only** Handles werden geteilt; mutable Handles bleiben pro Aufruf, weil `emporixLogin` bewusst zwei baut und dazwischen flusht.

**Tech Stack:** TypeScript, Next 16 (App Router, Node runtime), Vitest + MSW, pnpm workspace, Changesets.

## Global Constraints

- `@viu/emporix-sdk-next` importiert **kein** `react` und **kein** `@tanstack/react-query` — gepinnt durch `packages/next/tests/no-react-dependency.test.ts`. Jede Lösung, die das bricht, ist falsch.
- Node-Runtime-only im next-Package (`node:crypto` in `cookie-crypto.ts`). Kein Edge.
- Commitlint-Scopes: nur `repo, release, sdk, react, core, customer, product, category, cart, checkout, payment, price, media, segment, availability, auth, http, logger, deps, docs, examples`. **`next` ist kein erlaubter Scope.** Erstes Wort nach dem Scope kleingeschrieben.
- Jeder PR gegen `main` braucht einen Changeset — der Gate läuft unkonditioniert (`changeset-check.yml:26`).
- Feature-Branch pro Task-Gruppe, PR gegen `main`, kein Merge ohne Freigabe.
- **Keine Lasttests ausführen.** Verifikation erfolgt über Unit-Tests und, wo nötig, manuelles Zählen im Dev-Server-Log.
- Examples typechecken gegen `dist/`: nach SDK-/next-Änderungen `pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-next build` vor dem Example-Typecheck.

## Ausgangsmessung (aus der Analyse, nicht neu erheben)

| Pfad | Ist | Soll nach diesem Plan |
|---|---|---|
| Session-Reads pro Seitenaufruf `/cart` | 7 | **2** (Proxy + ein Render-Read) |
| Emporix-Calls pro Typeahead-Tastendruck | 1 | **0** bei Cache-Hit |
| TTFB-Blocker durch Session/Redis | ja | nein (Suspense-Insel) |
| `readMs` | 60 s | 8 s im Beispiel, Default unverändert |

## File Structure

| Datei | Verantwortung | Task |
|---|---|---|
| `packages/next/src/request-scope.ts` | **neu.** Per-Request-Memo über `WeakMap`, verankert an einem beliebigen request-scoped Objekt. Kennt keine Session-Semantik. | 1 |
| `packages/next/src/session-cookies.ts` | `emporixSessionHandle` teilt read-only Handles über das Memo; Body nach `buildHandle` extrahiert. | 1 |
| `packages/next/src/public-route.ts` | Upstream-`fetch` bekommt Tags + `revalidate`, Response bekommt `Cache-Control`. | 2 |
| `packages/next/src/client.ts` | `GetEmporixClientOptions.timeouts` inkl. Memo-Key. | 3 |
| `packages/next/src/session-client.ts` | `WithEmporixSessionOptions.timeouts` an `newGuestClient`. | 3 |
| `examples/next-server-first/app/emporix.ts` | Zentrale Timeout-Werte für das Beispiel. | 3 |
| `examples/next-server-first/app/lib/category-index.ts` | **neu.** Vorverarbeiteter Index (id → Label/Pfad/Kinder) in `unstable_cache`, statt 378 KiB Rohbaum pro Render. | 4 |
| `examples/next-server-first/app/components/header.tsx` | Statische Shell; der session-lesende Teil wandert in `session-nav.tsx`. | 5 |
| `examples/next-server-first/app/components/session-nav.tsx` | **neu.** Der einzige Teil des Headers, der die Session liest — hinter `Suspense`. | 5 |

---

### Task 1: Per-Request-Memo für read-only Session-Handles

Der Kern. Auf `/cart` werden heute sieben Handles gebaut, sechs davon read-only, jedes mit eigenem `await cookies()`, `await headers()`, Cookie-Parsing plus AES-GCM — und im Store-Modus mit eigenem Redis-`read`. Belegt: `token-proxy.ts:75`, `header.tsx:20`, `header.tsx:21`, `language-switcher.tsx:16`, `cart/page.tsx:20`, `site-context.ts:53`, `session-client.ts:102`.

**Files:**
- Create: `packages/next/src/request-scope.ts`
- Modify: `packages/next/src/session-cookies.ts:112-221` (Body von `emporixSessionHandle`)
- Test: `packages/next/tests/request-scope.test.ts` (neu), `packages/next/tests/session-store.test.ts` (bestehende Erwartungen prüfen)

**Interfaces:**
- Produces: `requestScoped<T>(anchor: object, key: string, build: () => Promise<T>): Promise<T>` — memoisiert das **Promise**, damit parallele Aufrufer denselben Bau teilen.
- Consumes: nichts aus anderen Tasks.

- [ ] **Step 1: Failing test für das Memo schreiben**

`packages/next/tests/request-scope.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { requestScoped } from "../src/request-scope";

describe("requestScoped", () => {
  it("builds once per anchor and key", async () => {
    const anchor = {};
    let builds = 0;
    const build = async () => {
      builds += 1;
      return { n: builds };
    };
    const a = await requestScoped(anchor, "k", build);
    const b = await requestScoped(anchor, "k", build);
    expect(a).toBe(b);
    expect(builds).toBe(1);
  });

  it("keeps different keys apart", async () => {
    const anchor = {};
    const a = await requestScoped(anchor, "read", async () => ({ mode: "read" }));
    const b = await requestScoped(anchor, "write", async () => ({ mode: "write" }));
    expect(a).not.toBe(b);
  });

  it("keeps different anchors apart — one request must not see another's", async () => {
    const first = await requestScoped({}, "k", async () => ({ id: 1 }));
    const second = await requestScoped({}, "k", async () => ({ id: 2 }));
    expect(first).not.toEqual(second);
  });

  it("shares one in-flight build between concurrent callers", async () => {
    const anchor = {};
    let builds = 0;
    const build = async () => {
      builds += 1;
      await new Promise((r) => setTimeout(r, 10));
      return { builds };
    };
    const [a, b] = await Promise.all([
      requestScoped(anchor, "k", build),
      requestScoped(anchor, "k", build),
    ]);
    expect(a).toBe(b);
    expect(builds).toBe(1);
  });

  it("does not cache a rejected build", async () => {
    const anchor = {};
    let calls = 0;
    const build = async () => {
      calls += 1;
      if (calls === 1) throw new Error("store down");
      return { ok: true };
    };
    await expect(requestScoped(anchor, "k", build)).rejects.toThrow("store down");
    // A transient store failure must not poison the whole request.
    await expect(requestScoped(anchor, "k", build)).resolves.toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `cd packages/next && npx vitest run tests/request-scope.test.ts`
Expected: FAIL — «Failed to resolve import "../src/request-scope"».

- [ ] **Step 3: `request-scope.ts` implementieren**

```ts
/**
 * Per-request memoization without React.
 *
 * `react`'s `cache()` would be the obvious tool and is deliberately not used:
 * this package has no React dependency and keeps it that way (see
 * `tests/no-react-dependency.test.ts`). `AsyncLocalStorage` is no help either —
 * it needs someone to open the context, and Next gives a library no hook that
 * wraps a render.
 *
 * What is left is an anchor that Next already scopes to the request: the object
 * returned by `await cookies()`. Keying a `WeakMap` on it gives exactly
 * request lifetime, and the entry dies with the request because nothing else
 * holds the anchor.
 *
 * The stored value is the **promise**, not the result — that is what makes two
 * concurrent callers share one build instead of racing.
 */
const scopes = new WeakMap<object, Map<string, Promise<unknown>>>();

export function requestScoped<T>(
  anchor: object,
  key: string,
  build: () => Promise<T>,
): Promise<T> {
  let slot = scopes.get(anchor);
  if (slot === undefined) {
    slot = new Map();
    scopes.set(anchor, slot);
  }
  const hit = slot.get(key);
  if (hit !== undefined) return hit as Promise<T>;

  // A rejection is NOT cached: a transient store outage would otherwise poison
  // every later read in the same request, turning one blip into a broken page.
  const made = build().catch((e: unknown) => {
    slot!.delete(key);
    throw e;
  });
  slot.set(key, made);
  return made;
}
```

- [ ] **Step 4: Test laufen lassen, grün bestätigen**

Run: `cd packages/next && npx vitest run tests/request-scope.test.ts`
Expected: PASS (5 Tests).

- [ ] **Step 5: `emporixSessionHandle` auf das Memo umstellen**

In `packages/next/src/session-cookies.ts` den bestehenden Funktionsbody nach `buildHandle` verschieben und die öffentliche Funktion so ersetzen:

```ts
export async function emporixSessionHandle(
  opts: { readOnly?: boolean; store?: EmporixSessionStore } = {},
): Promise<EmporixSessionHandle> {
  const jar = await cookies();
  const readOnly = opts.readOnly ?? false;

  // Only READ-ONLY handles are shared, and that is not a half measure.
  // `emporixLogin` builds a mutable handle, flushes it, and then lets
  // `onboardCart` build a SECOND one that must read what the first wrote — the
  // ordering trap the package README draws. Sharing mutable handles would
  // collapse those two into one and break login in store mode.
  //
  // Six of the seven handles a page view builds are read-only, so this still
  // takes /cart from seven session reads to one per render.
  if (!readOnly) return buildHandle(jar, opts);

  // The store is keyed coarsely (`cookie` vs `store`) because an app has one
  // session store — `examples/next-server-first` holds it in a module const.
  // Two different stores in one process would share an entry; that is a
  // documented limit, not an oversight.
  const key = `ro|${opts.store === undefined ? "cookie" : "store"}`;
  return requestScoped(jar, key, () => buildHandle(jar, opts));
}
```

`buildHandle` bekommt die Signatur `async function buildHandle(jar: Awaited<ReturnType<typeof cookies>>, opts: { readOnly?: boolean; store?: EmporixSessionStore }): Promise<EmporixSessionHandle>` und enthält den heutigen Code ab `const readOnly = opts.readOnly ?? false;` unverändert — inklusive `await isSecure()` und der Store-Hydration.

Import ergänzen: `import { requestScoped } from "./request-scope";`

- [ ] **Step 6: Failing test für das geteilte Handle schreiben**

In `packages/next/tests/session-store.test.ts` ergänzen (der `fakeStore` dort zählt Reads bereits nicht — deshalb ein eigener Zähler):

```ts
it("reads the store ONCE for two read-only handles in the same request", async () => {
  const store = fakeStore();
  let reads = 0;
  const counting = { ...store, read: async (id: string) => { reads += 1; return store.read(id); } };
  bag.set("emporix.sid", { name: "emporix.sid", value: "sid-1" });

  const a = await emporixSessionHandle({ readOnly: true, store: counting });
  const b = await emporixSessionHandle({ readOnly: true, store: counting });

  expect(a).toBe(b);
  expect(reads).toBe(1);
});

it("still builds a fresh handle for every MUTABLE call", async () => {
  // emporixLogin depends on this: it flushes handle 1 and expects handle 2 to
  // read the flushed record.
  const store = fakeStore();
  const a = await emporixSessionHandle({ store });
  const b = await emporixSessionHandle({ store });
  expect(a).not.toBe(b);
});
```

- [ ] **Step 7: Tests laufen lassen**

Run: `cd packages/next && npx vitest run tests/session-store.test.ts tests/session-client.test.ts tests/session-auth.test.ts`
Expected: PASS. Falls `session-auth.test.ts` bricht, ist die read-only-Abgrenzung falsch implementiert — nicht den Test anpassen, den Code prüfen.

- [ ] **Step 8: Volle Suite plus Typecheck**

Run: `pnpm -F @viu/emporix-sdk-next test && pnpm -F @viu/emporix-sdk-next build && pnpm typecheck`
Expected: alles grün, 10/10 Projekte.

- [ ] **Step 9: Anker-Identität manuell verifizieren**

Die Unit-Tests beweisen das Memo, nicht dass Next pro Request dasselbe `cookies()`-Objekt liefert — das ist ein Implementierungsdetail und muss einmal am laufenden Server geprüft werden.

```bash
cd examples/next-server-first
# In app/session-store.ts temporär: console.log("[redis] GET", id) in read() einfügen.
EMPORIX_SESSION_REDIS_URL=redis://localhost:6379 pnpm dev
# Dann /cart aufrufen und die GET-Zeilen pro Request zählen.
```

Erwartet: **2** Zeilen pro Seitenaufruf (Proxy plus ein Render-Read), vorher 7. Kommen weiterhin 7, ist die Anker-Annahme falsch — dann Task 1 auf `react`'s `cache()` umstellen und die peerDependency-Frage neu stellen (siehe «Offener Entscheidungspunkt»). Den `console.log` danach entfernen.

- [ ] **Step 10: Commit**

```bash
git add packages/next/src/request-scope.ts packages/next/src/session-cookies.ts packages/next/tests/
git commit -m "perf(repo): share the read-only session handle within one request"
```

---

### Task 2: Public-Route cachen

`public-route.ts:71-77` ruft `globalThis.fetch` ohne `next: { tags, revalidate }` und setzt keinen `Cache-Control`. Der Doc-Kommentar bei `:25-26` behauptet das Gegenteil («cached by Next once for all visitors»). Das ist die Route, die der Typeahead pro Tastendruck trifft.

**Files:**
- Modify: `packages/next/src/public-route.ts:34-83`
- Test: `packages/next/tests/public-route.test.ts`

**Interfaces:**
- Consumes: `emporixTagsForUrl(url: string, tenant: string): string[]` (unverändert).
- Produces: `createEmporixPublicRoute(opts?: { tenant?: string; revalidate?: number })` — Signatur unverändert, Verhalten gecacht.

- [ ] **Step 1: Failing test schreiben**

In `packages/next/tests/public-route.test.ts` ergänzen:

```ts
it("tags the upstream fetch so Next caches it for all visitors", async () => {
  let seenInit: (RequestInit & { next?: { tags?: string[]; revalidate?: number } }) | undefined;
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
    seenInit = init as typeof seenInit;
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }));

  const route = createEmporixPublicRoute({ tenant: "viu", revalidate: 600 });
  const res = await route(sameOriginRequest("/api/emporix/product/viu/products?q=shirt"), {
    params: Promise.resolve({ path: ["product", "viu", "products"] }),
  });

  expect(res.status).toBe(200);
  expect(seenInit?.next?.revalidate).toBe(600);
  expect(seenInit?.next?.tags).toContain("emporix:products");
});

it("lets a CDN cache the response too", async () => {
  // Without this header the response is private by default and every visitor
  // re-enters the Node process for the same public answer.
  const res = await routeWithStubbedUpstream({ revalidate: 600 });
  expect(res.headers.get("Cache-Control")).toBe(
    "public, s-maxage=600, stale-while-revalidate=60",
  );
});
```

`sameOriginRequest` und `routeWithStubbedUpstream` als lokale Helper in der Datei anlegen; `sameOriginRequest` setzt `Origin` und `Host` auf denselben Wert, damit `assertSameOrigin` passiert — die bestehende Datei hat dafür bereits ein Muster, das wiederverwendet wird.

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `cd packages/next && npx vitest run tests/public-route.test.ts`
Expected: FAIL — `seenInit?.next` ist `undefined`, `Cache-Control` ist `null`.

- [ ] **Step 3: Implementieren**

In `public-route.ts` den `fetch`-Aufruf und die Response ersetzen:

```ts
    const tags = emporixTagsForUrl(upstream, tenant);
    if (tags.length === 0) {
      return new Response("forbidden", { status: 403 });
    }

    const revalidate = opts.revalidate ?? 3600;
    const client = getEmporixClient({
      tenant,
      ...(opts.revalidate !== undefined ? { revalidate: opts.revalidate } : {}),
    });
    const session = await client.tokenProvider.getAnonymousToken();

    // Tagged and revalidated like every other cacheable Emporix GET. Without
    // this the route was an uncached passthrough: one billed Emporix call per
    // typeahead keystroke, for data every visitor shares. The same webhook that
    // invalidates a Server Component's catalog read invalidates this.
    const res = await fetch(upstream, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        Accept: "application/json",
      },
      next: { tags, revalidate },
    } as RequestInit & { next: { tags: string[]; revalidate: number } });

    return new Response(res.body, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "application/json",
        // The Node process is not the only cache in front of this. A public,
        // shared answer belongs in the CDN too.
        "Cache-Control": `public, s-maxage=${revalidate}, stale-while-revalidate=60`,
      },
    });
```

Dazu den falschen Kommentar bei `:25-26` und `:61-62` korrigieren — er darf jetzt stimmen.

- [ ] **Step 4: Tests laufen lassen**

Run: `cd packages/next && npx vitest run tests/public-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Kein Cache für Fehlerantworten prüfen**

Ergänzender Test, damit ein 500 vom Upstream nicht eine Stunde im CDN klebt:

```ts
it("does not let a CDN cache an upstream error", async () => {
  const res = await routeWithStubbedUpstream({ status: 502 });
  expect(res.status).toBe(502);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
});
```

Implementierung: `const cacheable = res.status >= 200 && res.status < 300;` und den Header entsprechend setzen.

- [ ] **Step 6: Commit**

```bash
git add packages/next/src/public-route.ts packages/next/tests/public-route.test.ts
git commit -m "perf(repo): cache the public catalog route instead of passing it through"
```

---

### Task 3: Timeouts konfigurierbar machen und im Beispiel setzen

`readMs` ist 60 s (`packages/sdk/src/core/config.ts:93`). Bei 1'000 CCU hält ein langsamer Upstream damit eine Minute lang Sockets und Event-Loop-Tasks pro Request. Der Default bleibt (Änderung wäre breaking für bestehende Konsumenten), aber er muss von aussen setzbar sein — heute nimmt weder `getEmporixClient` noch `withEmporixSession` Timeouts an.

**Files:**
- Modify: `packages/next/src/client.ts:47-133` (Option plus Memo-Key)
- Modify: `packages/next/src/session-client.ts:12-34` und `:105-127` (Option an `newGuestClient`)
- Modify: `examples/next-server-first/app/emporix.ts` (Werte), `app/lib/site-context.ts:64-69` (durchreichen)
- Test: `packages/next/tests/client.test.ts`, `packages/next/tests/session-client.test.ts`

**Interfaces:**
- Produces: `GetEmporixClientOptions.timeouts?: { connectMs?: number; readMs?: number }` und `WithEmporixSessionOptions.timeouts?: { connectMs?: number; readMs?: number }`.

- [ ] **Step 1: Failing test schreiben**

In `packages/next/tests/client.test.ts`:

```ts
it("passes timeouts through and keys the memo on them", () => {
  const fast = getEmporixClient({ timeouts: { readMs: 8_000 } });
  const slow = getEmporixClient({ timeouts: { readMs: 30_000 } });
  expect(fast.config.timeouts.readMs).toBe(8_000);
  expect(slow.config.timeouts.readMs).toBe(30_000);
  // Two different budgets must not collapse into one instance.
  expect(fast).not.toBe(slow);
  expect(getEmporixClient({ timeouts: { readMs: 8_000 } })).toBe(fast);
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `cd packages/next && npx vitest run tests/client.test.ts`
Expected: FAIL — `timeouts` ist kein bekanntes Feld (TS-Fehler bzw. `readMs` bleibt 60000).

- [ ] **Step 3: Option in `client.ts` ergänzen**

```ts
  /**
   * Per-request budgets. The SDK default is 10 s to headers and 60 s to the end
   * of the body — generous, and at high concurrency that is the problem: a slow
   * upstream holds a socket and an event-loop task for a minute per request.
   * A storefront should pick something it would actually wait for.
   */
  timeouts?: { connectMs?: number; readMs?: number };
```

Im Memo-Key ergänzen (sonst teilen zwei Budgets eine Instanz):

```ts
  const key = `${tenant}|${clientId}|${host ?? ""}|${tagged}|${revalidate}|${JSON.stringify(opts.context ?? {})}|${JSON.stringify(opts.timeouts ?? {})}`;
```

Und beim Konstruieren durchreichen: `...(opts.timeouts !== undefined ? { timeouts: opts.timeouts } : {}),`

- [ ] **Step 4: Dasselbe in `session-client.ts`**

`WithEmporixSessionOptions` bekommt dasselbe Feld mit demselben Kommentar, `newGuestClient` reicht es an `new EmporixClient` durch, und der Customer-Pfad gibt es via `getEmporixClient({ ...opts, tagged: false })` automatisch weiter (spreadet bereits alles).

- [ ] **Step 5: Tests laufen lassen**

Run: `cd packages/next && npx vitest run tests/client.test.ts tests/session-client.test.ts`
Expected: PASS.

- [ ] **Step 6: Im Beispiel setzen**

`examples/next-server-first/app/emporix.ts`:

```ts
/**
 * What this storefront is willing to wait for.
 *
 * The SDK default is 60 s to the end of the body. Nobody waits a minute for a
 * cart page, and at 1'000 concurrent users that budget is what turns one slow
 * Emporix minute into a process full of parked requests. 8 s is above the p99
 * of every call this app makes and far below «the user already left».
 */
export const TIMEOUTS = { connectMs: 3_000, readMs: 8_000 } as const;
```

In `app/lib/site-context.ts` in `emporixOptions()` ergänzen: `timeouts: TIMEOUTS,` — und an jeder `getEmporixClient({ context: … })`-Stelle mitgeben. Betroffen: `app/page.tsx:31`, `app/search/page.tsx`, `app/product/[id]/page.tsx:33`, `app/category/[id]/page.tsx:37`, `app/lib/category-tree.ts:27`.

- [ ] **Step 7: Typecheck über das Beispiel**

Run: `pnpm -F @viu/emporix-sdk-next build && pnpm -F @viu/emporix-examples-next-server-first typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/next/src/client.ts packages/next/src/session-client.ts packages/next/tests/ examples/next-server-first/app/
git commit -m "perf(repo): make the request budgets configurable and pick sane ones in the demo"
```

---

### Task 4: Kategoriebaum als vorverarbeiteter Index

`category-tree.ts:20` dokumentiert 1'631 Knoten / 378 KiB. Der Data-Cache spart den Netzwerk-Call, nicht das `JSON.parse` pro Render (`http.ts:154`) und nicht den Walk über 1'631 Knoten in `findCategory` (`category/[id]/page.tsx:55`). Bei ~40 Kategorie-Renders/s sind das ~15 MB/s Parsing.

**Files:**
- Create: `examples/next-server-first/app/lib/category-index.ts`
- Modify: `examples/next-server-first/app/category/[id]/page.tsx:44-57`, `app/categories/page.tsx:17`
- Test: `examples/next-server-first/tests/category-index.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface CategoryEntry { id: string; label: string; path: { id: string; label: string }[]; children: { id: string; label: string }[]; }
  function categoryIndex(): Promise<{ roots: { id: string; label: string }[]; byId: Record<string, CategoryEntry> }>
  ```
- Consumes: `categoryTree()` aus `app/lib/category-tree.ts`, `findCategory` aus `app/lib/category-walk.ts` (letzteres wird durch den Index ersetzt, bleibt aber für `categories/page.tsx` bestehen, bis Step 5 es entfernt).

- [ ] **Step 1: Failing test schreiben**

`examples/next-server-first/tests/category-index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildIndex } from "../app/lib/category-index";

const TREE = [
  {
    id: "root",
    name: { en: "Root" },
    subcategories: [
      { id: "kid", name: { en: "Kid" }, subcategories: [{ id: "grandkid", name: { en: "Grandkid" } }] },
    ],
  },
];

describe("buildIndex", () => {
  it("flattens every node into a lookup", () => {
    const idx = buildIndex(TREE as never);
    expect(Object.keys(idx.byId).sort()).toEqual(["grandkid", "kid", "root"]);
  });

  it("carries the breadcrumb path, root first", () => {
    const idx = buildIndex(TREE as never);
    expect(idx.byId["grandkid"]?.path.map((p) => p.id)).toEqual(["root", "kid"]);
  });

  it("carries the direct children only", () => {
    const idx = buildIndex(TREE as never);
    expect(idx.byId["root"]?.children.map((c) => c.id)).toEqual(["kid"]);
    expect(idx.byId["grandkid"]?.children).toEqual([]);
  });

  it("lists the roots", () => {
    expect(buildIndex(TREE as never).roots.map((r) => r.id)).toEqual(["root"]);
  });

  it("survives a node without subcategories or name", () => {
    // The tenant's tree has 1'631 nodes; assuming every one is well-formed is
    // how a single missing field 500s a category page.
    const idx = buildIndex([{ id: "bare" }] as never);
    expect(idx.byId["bare"]).toEqual({ id: "bare", label: "bare", path: [], children: [] });
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `cd examples/next-server-first && npx vitest run tests/category-index.test.ts`
Expected: FAIL — Modul fehlt.

- [ ] **Step 3: `category-index.ts` implementieren**

```ts
import { unstable_cache } from "next/cache";
import type { CategoryNode } from "@viu/emporix-sdk";
import { pickText } from "@viu/emporix-examples-shared";
import { categoryTree } from "./category-tree";

export interface CategoryEntry {
  id: string;
  label: string;
  /** Ancestors, root first. Empty for a root. */
  path: { id: string; label: string }[];
  children: { id: string; label: string }[];
}

export interface CategoryIndex {
  roots: { id: string; label: string }[];
  byId: Record<string, CategoryEntry>;
}

/**
 * Flattens the tree once so a page render does not walk 1'631 nodes.
 *
 * Exported separately from the cached wrapper so it is testable without Next —
 * `unstable_cache` needs a request scope, a pure function does not.
 */
export function buildIndex(roots: CategoryNode[]): CategoryIndex {
  const byId: Record<string, CategoryEntry> = {};
  const label = (n: CategoryNode): string => pickText(n.name) || n.id || "";

  const walk = (node: CategoryNode, path: { id: string; label: string }[]): void => {
    const id = node.id;
    if (id === undefined) return;
    const kids = node.subcategories ?? [];
    byId[id] = {
      id,
      label: label(node),
      path,
      children: kids
        .filter((k) => k.id !== undefined)
        .map((k) => ({ id: k.id as string, label: label(k) })),
    };
    const next = [...path, { id, label: label(node) }];
    for (const k of kids) walk(k, next);
  };

  for (const r of roots) walk(r, []);
  return {
    roots: roots.filter((r) => r.id !== undefined).map((r) => ({ id: r.id as string, label: label(r) })),
    byId,
  };
}

/**
 * The index for this request, cached for an hour.
 *
 * Two caches stack here on purpose: the SDK's tagged fetch keeps the 378 KiB
 * tree out of the network, and this keeps the parse and the walk out of the
 * render. The `emporix:categories` tag invalidates the inner one; the hour
 * bounds this one, so a webhook-driven category change shows up within the hour
 * rather than instantly. That is the trade the flat index buys.
 */
export const categoryIndex = unstable_cache(
  async (): Promise<CategoryIndex> => buildIndex(await categoryTree()),
  ["emporix-category-index"],
  { revalidate: 3600, tags: ["emporix:categories"] },
);
```

- [ ] **Step 4: Tests laufen lassen**

Run: `cd examples/next-server-first && npx vitest run tests/category-index.test.ts`
Expected: PASS (5 Tests).

- [ ] **Step 5: Kategorieseite auf den Index umstellen**

In `app/category/[id]/page.tsx` `categoryTree()` plus `findCategory` ersetzen:

```ts
  const index = await categoryIndex();
  const entry = index.byId[id];
  if (entry === undefined) notFound();
  const children = entry.children;
```

Breadcrumb kommt aus `entry.path`. In `app/categories/page.tsx` `categoryTree()` durch `categoryIndex()` und `roots` ersetzen. Danach prüfen, ob `app/lib/category-walk.ts` noch Verwendung hat — wenn nicht, samt Test löschen (`tests/category-tree.test.ts` prüfen, nicht blind entfernen).

- [ ] **Step 6: Typecheck plus Beispiel-Tests**

Run: `pnpm -F @viu/emporix-examples-next-server-first typecheck && cd examples/next-server-first && npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add examples/next-server-first/app/lib/ examples/next-server-first/app/category examples/next-server-first/app/categories examples/next-server-first/tests/
git commit -m "perf(examples): flatten the category tree into a cached index"
```

---

### Task 5: Header als Suspense-Insel

Der Header liest in `header.tsx:20-21` die Session und sitzt im Root-Layout. Damit wartet die TTFB **jeder** Seite auf den Session-Read — nach Task 1 nur noch einer, aber im Store-Modus immer noch ein Redis-Round-Trip vor dem ersten Byte.

**Files:**
- Create: `examples/next-server-first/app/components/session-nav.tsx`
- Modify: `examples/next-server-first/app/components/header.tsx`
- Test: manuelle Prüfung (Step 5) — kein Unit-Test, weil der Nutzen Streaming-Verhalten ist und kein Rückgabewert.

**Interfaces:**
- Produces: `SessionNav(): Promise<React.JSX.Element>` — der session-abhängige Teil (Cart-Badge, Login/Account/Logout).
- Consumes: `cartCount(handle)` aus `app/lib/cart-session.ts`, `emporixSessionHandle`, `emporixSession`.

- [ ] **Step 1: `session-nav.tsx` anlegen**

```tsx
import { emporixSession, emporixSessionHandle } from "@viu/emporix-sdk-next/session";
import { STORE_OPT } from "../emporix";
import { cartCount } from "../lib/cart-session";
import { logout } from "../actions/auth";

/**
 * The only part of the shell that reads the session.
 *
 * Split out of `Header` so it can sit behind `Suspense`: the static shell — logo,
 * search box, links — flushes to the browser immediately, and the cart badge
 * streams in when the session read is done. Before this split the whole page's
 * TTFB waited on a Redis round trip that the visitor did not need to see the
 * page.
 *
 * Still zero Emporix calls: the count comes from the session, «am I logged in»
 * from whether a token is stored.
 */
export async function SessionNav(): Promise<React.JSX.Element> {
  const handle = await emporixSessionHandle({ readOnly: true, ...STORE_OPT });
  const { customerToken } = await emporixSession(STORE_OPT);
  const count = cartCount(handle);

  return (
    <>
      <a href="/cart" className="u-underline">
        Cart{count > 0 ? ` (${count})` : ""}
      </a>
      {customerToken === null ? (
        <a href="/login" className="u-underline">
          Login
        </a>
      ) : (
        <>
          <a href="/account" className="u-underline">
            Account
          </a>
          <form action={logout} style={{ display: "inline" }}>
            <button type="submit" className="btn btn--ghost btn--sm">
              Log out
            </button>
          </form>
        </>
      )}
    </>
  );
}
```

- [ ] **Step 2: `header.tsx` zur statischen Shell machen**

`async` entfällt, die zwei Session-Reads verschwinden, und der navigationsseitige Teil wird:

```tsx
        <nav
          className="cluster"
          style={{ gap: "var(--s-4)", marginLeft: "auto", fontSize: "var(--step--1)" }}
        >
          <LanguageSwitcher />
          <a href="/categories" className="u-underline">
            Categories
          </a>
          {/* The fallback is a real link, not a spinner: a shell that reflows
              when the badge arrives is worse than one that starts complete.
              Same width, same position, no layout shift. */}
          <Suspense fallback={<a href="/cart" className="u-underline">Cart</a>}>
            <SessionNav />
          </Suspense>
          <a href="/debug" className="u-underline">
            Debug
          </a>
        </nav>
```

Imports: `import { Suspense } from "react";` und `import { SessionNav } from "./session-nav";`. Der Doc-Kommentar oben in der Datei muss mitwandern — er behauptet «zero Emporix calls», was weiterhin stimmt, aber die Begründung «putting the header in the root layout costs nothing per page view» braucht den Zusatz, dass der Session-Teil jetzt streamt.

Hinweis: `LanguageSwitcher` liest in `language-switcher.tsx:16` ebenfalls die Session. Nach Task 1 teilt er das Handle mit `SessionNav`, blockiert aber weiterhin die Shell. Ihn in dieselbe `Suspense`-Grenze zu ziehen ist der nächste Schritt, wenn die Messung in Step 5 ihn als Blocker zeigt.

- [ ] **Step 3: Typecheck**

Run: `pnpm -F @viu/emporix-examples-next-server-first typecheck`
Expected: PASS.

- [ ] **Step 4: Beispiel-Tests**

Run: `cd examples/next-server-first && npx vitest run`
Expected: PASS (unverändert — keiner der drei Tests berührt den Header).

- [ ] **Step 5: Streaming manuell prüfen**

```bash
cd examples/next-server-first && pnpm dev
curl -N -s -o /dev/null -w "TTFB %{time_starttransfer}s total %{time_total}s\n" http://localhost:3000/categories
```

Erwartet: `time_starttransfer` deutlich kleiner als `time_total` — die Shell kommt vor dem Session-Teil. Sind beide gleich, greift das Streaming nicht (häufigste Ursache: ein `await` oberhalb der `Suspense`-Grenze im Layout).

- [ ] **Step 6: Commit**

```bash
git add examples/next-server-first/app/components/
git commit -m "perf(examples): stream the session part of the header"
```

---

### Task 6: Doku, Changesets, PR

**Files:**
- Modify: `packages/next/README.md` (Abschnitt «How the session is managed» plus die Public-Route-Doku)
- Modify: `docs/nextjs.md` — existiert nicht; stattdessen `packages/next/README.md` und `examples/next-server-first/README.md`
- Create: `.changeset/session-handle-request-scope.md`, `.changeset/public-route-caching.md`, `.changeset/configurable-timeouts.md`

- [ ] **Step 1: next-README ergänzen**

Unter «How the session is managed» einen Absatz, der die neue Invariante nennt: read-only Handles sind pro Request geteilt, mutable nicht, und warum (Login-Ordering). Plus im Public-Route-Abschnitt: die Antwort ist jetzt getaggt und CDN-cachebar, Fehler sind `no-store`.

- [ ] **Step 2: Changesets schreiben**

```markdown
---
"@viu/emporix-sdk-next": minor
---

Share the read-only session handle within one request. A page view built up to
seven handles for the same record — six of them read-only — so in store mode it
cost seven Redis reads, and in cookie mode seven parses plus seven AES-GCM
opens. They now resolve to one, memoized on the request-scoped object
`await cookies()` returns.

Mutable handles are deliberately NOT shared: `emporixLogin` builds one, flushes
it, and lets the cart onboarding build a second that must read what the first
wrote. Sharing them would collapse that ordering and break login in store mode.

No React: `cache()` would have been the obvious tool and would have re-added the
dependency this package removed in 0.7.0.
```

Analog für die Public-Route (`patch` reicht nicht — Verhalten ändert sich sichtbar, also `minor`) und die Timeouts (`minor`, neue Option).

- [ ] **Step 3: Volle Verifikation**

```bash
pnpm -r build && pnpm typecheck && pnpm -r test && pnpm lint
```
Expected: alles grün. Zahlen im PR-Text nennen, nicht «alles grün» behaupten.

- [ ] **Step 4: PR öffnen**

```bash
git push -u origin perf/1000-ccu
gh pr create --base main --title "perf(repo): the four fixes the 1'000-CCU analysis found" --body-file <pfad>
```

Im PR-Text die Vorher/Nachher-Tabelle aus «Ausgangsmessung» führen und **explizit** vermerken, was **nicht** verifiziert ist: kein Lasttest gelaufen, die Zahlen stammen aus Code-Analyse plus dem manuellen Zählen in Task 1 Step 9 und Task 5 Step 5.

---

## Bewusst nicht in diesem Plan

**ISR für Katalogseiten — eigener Plan, eigener PR.** Der gewählte Scope war «Header als Suspense-Insel, Katalog auf ISR». Der erste Teil ist Task 5 hier. Der zweite ist mit dem heutigen Code nicht erreichbar: jede Katalogseite ruft `siteContext()` (`app/lib/site-context.ts:53`), das die Sprache aus einem Cookie liest, und ein Cookie-Read macht die Route unwiderruflich dynamisch. `revalidate` daraufzusetzen ändert nichts.

Echtes ISR braucht die Sprache **in der URL** statt im Cookie — ein `[lang]`-Segment mit `generateStaticParams`, plus einen Header, der die Session nicht mehr serverseitig liest. Das ist ein Routing-Umbau mit Auswirkung auf jeden Link und den Sprachumschalter, deshalb steht er in **[2026-08-05-catalog-isr.md](./2026-08-05-catalog-isr.md)** und wird als **eigener PR** umgesetzt.

Reihenfolge: Task 5 dieses Plans (Suspense-Insel) und der ISR-Plan berühren beide `header.tsx`. Der ISR-Plan macht den Header zu einer Client-Komponente und ersetzt die Suspense-Insel damit. Wer beide umsetzt, baut den ISR-Plan **nach** Task 5 und wirft die Insel dabei weg — oder überspringt Task 5, wenn der ISR-PR ohnehin ansteht.

Was Task 5 stattdessen liefert: die Seiten bleiben dynamisch, aber der Session-Read blockiert das erste Byte nicht mehr, und die Upstream-Daten sind über den Data-Cache ohnehin geteilt. Der CDN-Gewinn von ~60 % der Seitenaufrufe bleibt bis zum i18n-Routing offen.

**49 HttpClients pro Gast-Request** (`client.ts:128-179` × `create-core.ts:71`). Real, aber nicht belegt als Flaschenhals — ~2'500 Allokationen/s sind für V8 wenig. Der Fix (Lazy-Getter statt 49 Felder) berührt die öffentliche Form von `EmporixClient` und gehört erst gebaut, wenn ein Profil ihn zeigt. Ohne Lasttest gibt es dieses Profil nicht, also steht er hier als Notiz und nicht als Task.

**Circuit Breaker im SDK.** Bei einem Emporix-Brownout verdreifachen die drei Retry-Versuche die Last (`http.ts:213-231`). Ein Breaker ist die richtige Antwort, aber er braucht eine Entscheidung über Fehlerbudget, Halb-offen-Verhalten und ob er pro Origin oder pro Service greift — eine eigene Spec, kein Task in einem Performance-Plan.

**Emporix-Rate-Limit.** Im Repo nicht dokumentiert (`grep` über `packages/` und `docs/`: nur reaktive 429-Behandlung). Muss bei Emporix erfragt werden, bevor 1'000 CCU zugesagt werden — das ist eine Vertrags-, keine Code-Frage.

**Bilder.** `<img>` statt `next/image` (`product-grid.tsx:34`, `product/[id]/page.tsx:81`). Kostet keine Serverkapazität, deshalb nicht in diesem Plan; für LCP und Emporix-Egress trotzdem offen.

## Offener Entscheidungspunkt

Task 1 Step 9 verifiziert die Annahme, dass `await cookies()` pro Request dasselbe Objekt liefert. Fällt sie durch, gibt es zwei Auswege, und beide brauchen eine Entscheidung:

1. `react`'s `cache()` im next-Package — funktioniert garantiert, holt aber `react` als peerDependency zurück, das 0.7.0 gerade entfernt hat.
2. Das Memo in die App verschieben — Package bleibt React-frei, jeder Konsument muss den Fix selbst bauen.

## Self-Review

**Spec-Abdeckung:** Session-Verstärkung → Task 1. Public-Route → Task 2. Timeouts → Task 3. Baum-Parsing → Task 4. TTFB/Streaming → Task 5. Doku/Release → Task 6. ISR, Lazy-Services, Breaker, Rate-Limit, Bilder → explizit ausgeschlossen mit Begründung. Keine Lücke gegenüber der Top-5-Liste der Analyse.

**Placeholder-Scan:** Kein «TBD», kein «add error handling», jeder Code-Step enthält den tatsächlichen Code. Task 5 hat bewusst keinen Unit-Test, mit Begründung und einem verifizierbaren manuellen Check statt eines leeren Test-Steps.

**Typkonsistenz:** `requestScoped(anchor, key, build)` in Task 1 wird in `session-cookies.ts` mit genau dieser Signatur benutzt. `CategoryIndex.byId[id]` in Task 4 Step 5 entspricht dem in Step 3 definierten Typ. `SessionNav` in Task 5 Step 1 wird in Step 2 unter demselben Namen importiert. `TIMEOUTS` aus Task 3 Step 6 wird in `emporixOptions()` und an fünf `getEmporixClient`-Stellen verwendet, alle namentlich genannt.
