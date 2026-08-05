# Prefetch-Guard für den Emporix-Proxy — Implementation Plan

> ## ⛔ VERWORFEN am 2026-08-05 — nicht umsetzen
>
> **Die Grundannahme dieses Plans ist widerlegt.** In der Next-Middleware ist ein
> Prefetch nicht erkennbar: Next entfernt jedes eigene Router-Signal, bevor die
> Middleware läuft. Gemessen an einem echten `<Link prefetch>` in Chrome gegen
> `next start` (Next 16.2.12), Sonde als Antwort-Header:
>
> | Signal | Vom Browser gesendet | Von der Middleware gesehen |
> |---|---|---|
> | `next-router-prefetch` | `1` | **`null`** |
> | `rsc` | `1` | **`null`** |
> | `next-router-segment-prefetch` | `/_tree` | **`null`** |
> | `_rsc`-Query-Parameter | in der URL | **nicht sichtbar** |
> | `sec-purpose` | nicht gesendet | `null` |
>
> `Sec-Purpose` überlebt zwar, wird von Chrome für einen `fetch()`-basierten
> Next-Prefetch aber nicht gesetzt — es deckt nur Browser-Speculation-Rules ab,
> nicht den Fall, der diesen Plan motiviert hat.
>
> Was die Middleware **kann**: eine echte Dokument-Navigation (`sec-fetch-mode:
> navigate`) von allem anderen unterscheiden. Sie kann aber einen Prefetch nicht
> von einer echten clientseitigen Navigation trennen — beide sind `cors`.
>
> Die Implementierung war fertig und getestet (Prädikat mit 8 Tests, beide Guards,
> Paket-Suite 250 grün) und wurde zurückgenommen, weil sie für den motivierenden
> Fall nachweislich nie greift. Toter Code ist schlechter als kein Code.
>
> **Der Prefetch hat dabei einen eigenständigen Defekt aufgedeckt** — ein Prefetch
> auf einen Link in der anderen Sprache stellt die Sprache des Besuchers um. Der
> steht jetzt in [`../specs/2026-08-05-language-write-from-proxy.md`](../specs/2026-08-05-language-write-from-proxy.md)
> samt umsetzbarer Optionen. Die Prefetch-Kosten gegen Emporix löst stattdessen
> `prefetch={false}` auf den teuren Links, ohne jede Paketänderung.
>
> Der Rest dieser Datei bleibt als Protokoll stehen: was geplant war, und woran es
> gescheitert ist.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `emporixTokenProxy` und `emporixSiteProxy` dürfen auf einem spekulativen Prefetch-Request keinen Besucherzustand mehr verändern — keine Token-Rotation, kein `Set-Cookie`.

**Architecture:** Ein reines Prädikat (`isPrefetchRequest`) in eigener Datei erkennt den Prefetch an den Request-Headern. `emporixTokenProxy` überspringt damit die Token-Rotation, `emporixSiteProxy` unterdrückt damit die `Set-Cookie`-Zeilen — **injiziert aber weiter in die weitergeleiteten Request-Cookies**, damit der spekulative Render trotzdem die richtige Sprache benutzt. Kein neues Options-Feld: niemand will, dass ein Hover seinen Token rotiert, also gibt es nichts zu konfigurieren.

**Tech Stack:** TypeScript, Next 16 (`NextRequest`/`NextResponse` aus `next/server`), Vitest, Changesets.

## Warum das nötig ist

Gemessen am 2026-08-05: **kein Prefetch-Guard** in `packages/next/src/token-proxy.ts` oder `packages/next/src/proxy.ts`, und `emporixRefresh` in `packages/next/src/session-auth.ts` hat **keine Entdopplung** — kein Lock, keine In-Flight-Map. Heute ist das latent, weil eine Navigation genau einen Proxy-Durchlauf auslöst. Sobald ein Konsument `<Link>` mit Prefetch benutzt, wird aus einem Hover über ein Produktraster ein Schwung paralleler Durchläufe, die alle denselben stale Token sehen.

Zwei konkrete Schäden:

1. **Token-Rotation auf Verdacht.** Ein Prefetch für eine Seite, die niemand anklickt, löst einen Emporix-Auth-Aufruf aus. Bei paralleler Ausführung lösen mehrere Durchläufe denselben Refresh-Token ein; landet ein bereits invalidierter Token als letzter im Cookie, bricht die Sitzung.
2. **Sprachwechsel durch Hover.** `emporixSiteProxy` schreibt `emporix.language` aus dem Pfadsegment. Ein Prefetch eines Links in der anderen Sprache würde das Cookie umschreiben — der Besucher sieht danach seinen Warenkorb in einer Sprache, die er nie gewählt hat. Das bricht genau den Fix aus PR #230.

## Global Constraints

- **Commitlint-Scope:** `next` ist **nicht** in der Allowlist (`commitlint.config.js`). Für diese Änderung ist `auth` der Scope — die tragende Änderung ist die Token-Rotation. Erstes Wort nach dem Scope muss ein kleingeschriebenes Verb sein.
- **Kein `RSC: 1` als Signal.** Jede clientseitige Navigation sendet `RSC: 1`, nicht nur der Prefetch. `RSC` als Erkennung zu benutzen würde die Rotation bei echten Navigationen abschalten — das wäre ein schlimmerer Fehler als der behobene.
- **`emporix.siteCode` und `emporix.language` werden gemeinsam behandelt.** Beide stehen in `PUBLIC_KEYS` (`packages/next/src/session-store.ts:48`) und beide sind Besucherzustand. Kein Sonderfall für einen der zwei.
- **Weitergeleitete Request-Cookies bleiben.** `request.cookies.set(...)` ist per-Request und persistiert nichts; der spekulative Render braucht die richtige Sprache. Nur `response.cookies.set(...)` ist die Mutation, die unterdrückt wird.
- **Changeset erforderlich.** `.changeset/` mit `@viu/emporix-sdk-next: patch`. `changeset-check.yml` läuft bedingungslos und `pnpm changeset status --since=origin/main` muss einen Bump finden, weil ein veröffentlichtes Paket sich ändert.
- **Keine neue Dependency.** Die Header-Prüfung ist `request.headers.get`.

## Ausdrücklich nicht in diesem Plan

**Die Entdopplung von `emporixRefresh` bleibt offen.** Der Guard entfernt den Verstärker, nicht die zugrunde liegende Race: zwei gleichzeitige *echte* Navigationen können weiter parallel refreshen. Eine korrekte Behebung braucht ein Lock, und eine modulweite `Map` reicht dafür nicht — im Edge-/Serverless-Betrieb existiert sie pro Instanz. Das braucht den Session-Store und ist eine eigene, grössere Aufgabe. Nach diesem Plan als separates Item anlegen.

## File Structure

| Datei | Verantwortung |
|---|---|
| `packages/next/src/prefetch.ts` (**neu**) | Nur das Prädikat. Rein, ohne Imports, damit Vitest es direkt lädt — dasselbe Muster wie `examples/next-server-first/app/lib/path-language.ts`. |
| `packages/next/tests/prefetch.test.ts` (**neu**) | Tests für das Prädikat, inklusive der Falle `RSC: 1` ist kein Prefetch. |
| `packages/next/src/proxy.ts` (ändern) | Unterdrückt die `Set-Cookie`-Schleife auf Prefetch. |
| `packages/next/tests/proxy.test.ts` (ändern) | Zwei Tests dazu: kein `Set-Cookie`, aber weiterhin injizierte Request-Cookies. |
| `packages/next/src/token-proxy.ts` (ändern) | Überspringt die Rotation auf Prefetch. |
| `packages/next/tests/token-proxy.test.ts` (ändern) | Ein Test: stale Token plus Prefetch-Header ⇒ null Refreshes. |
| `packages/next/README.md` (ändern) | Abschnitte bei Zeile 272 («Token rotation belongs in the proxy») und 774 («Site and locale detection»). |
| `.changeset/<name>.md` (**neu**) | Patch-Bump. |

`prefetch.ts` wird **nicht** aus `src/session.ts` re-exportiert. Konsumenten brauchen das Prädikat nicht — der Guard wirkt automatisch. Ein Export wäre eine öffentliche Oberfläche ohne Nachfrage (YAGNI); er lässt sich später ohne Bruch nachziehen.

---

### Task 1: Das Prefetch-Prädikat

**Files:**
- Create: `packages/next/src/prefetch.ts`
- Test: `packages/next/tests/prefetch.test.ts`

**Interfaces:**
- Consumes: nichts (rein, keine Imports)
- Produces: `isPrefetchRequest(request: { headers: { get(name: string): string | null } }): boolean` — Task 2 und 3 importieren das als `import { isPrefetchRequest } from "./prefetch";`

Der Parametertyp ist absichtlich strukturell und nicht `NextRequest`: so lädt der Test die Datei ohne `next/server`, und die Funktion bleibt für jeden Request-artigen Wert benutzbar.

- [ ] **Step 1: Write the failing test**

Create `packages/next/tests/prefetch.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isPrefetchRequest } from "../src/prefetch";

/** Ein minimaler Request-Stub: das Praedikat liest nur `headers.get`. */
function req(headers: Record<string, string>): { headers: { get(n: string): string | null } } {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { headers: { get: (n) => lower.get(n.toLowerCase()) ?? null } };
}

describe("isPrefetchRequest", () => {
  it("erkennt den App-Router-Prefetch", () => {
    expect(isPrefetchRequest(req({ "Next-Router-Prefetch": "1" }))).toBe(true);
  });

  it("erkennt Sec-Purpose: prefetch", () => {
    expect(isPrefetchRequest(req({ "Sec-Purpose": "prefetch" }))).toBe(true);
  });

  it("erkennt Sec-Purpose mit Zusatz-Token", () => {
    // Chrome sendet bei Speculation Rules `prefetch;prerender`.
    expect(isPrefetchRequest(req({ "Sec-Purpose": "prefetch;prerender" }))).toBe(true);
  });

  it("erkennt das aeltere purpose: prefetch", () => {
    expect(isPrefetchRequest(req({ purpose: "prefetch" }))).toBe(true);
  });

  it("ist gegen Gross-/Kleinschreibung des Wertes robust", () => {
    expect(isPrefetchRequest(req({ "Sec-Purpose": "PREFETCH" }))).toBe(true);
  });

  it("behandelt RSC: 1 NICHT als Prefetch", () => {
    // Die Falle: jede clientseitige Navigation sendet RSC. Waere das das Signal,
    // wuerde die Token-Rotation bei echten Navigationen ausfallen.
    expect(isPrefetchRequest(req({ RSC: "1" }))).toBe(false);
  });

  it("behandelt eine gewoehnliche Dokumentanfrage nicht als Prefetch", () => {
    expect(isPrefetchRequest(req({ accept: "text/html" }))).toBe(false);
  });

  it("behandelt einen leeren Header nicht als Prefetch", () => {
    expect(isPrefetchRequest(req({ "Next-Router-Prefetch": "" }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/next && npx vitest run tests/prefetch.test.ts
```

Expected: FAIL — `Cannot find module '../src/prefetch'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/next/src/prefetch.ts`:

```ts
/**
 * Ist dieser Request spekulativ?
 *
 * Ein Prefetch ist eine Vermutung des Browsers, nicht eine Handlung des
 * Besuchers. Er darf deshalb keinen Besucherzustand veraendern: keinen Token
 * rotieren (das kostet einen Emporix-Aufruf und kann bei parallelen Prefetches
 * denselben Refresh-Token mehrfach einloesen) und kein Sprach-Cookie schreiben
 * (sonst wechselt ein Hover ueber einen Link in der anderen Sprache die Sprache
 * des Besuchers).
 *
 * Drei Header, weil drei Quellen sie senden:
 * - `Next-Router-Prefetch` — der App-Router-`<Link>`-Prefetch
 * - `Sec-Purpose` — der standardisierte Header der Speculation Rules, dessen Wert
 *   auch `prefetch;prerender` sein kann, deshalb `includes` und nicht `===`
 * - `purpose` — die aeltere Konvention, die manche Browser und Proxies noch senden
 *
 * **`RSC` ist absichtlich nicht dabei.** Diesen Header sendet jede clientseitige
 * Navigation, nicht nur der Prefetch. Ihn als Signal zu nehmen wuerde die
 * Token-Rotation bei echten Navigationen abschalten — ein schlimmerer Fehler als
 * der, den diese Funktion behebt.
 *
 * Der Parametertyp ist strukturell und nicht `NextRequest`, damit die Datei ohne
 * `next/server` testbar bleibt.
 */
export function isPrefetchRequest(request: {
  headers: { get(name: string): string | null };
}): boolean {
  if (request.headers.get("next-router-prefetch") === "1") return true;
  const purpose =
    request.headers.get("sec-purpose") ?? request.headers.get("purpose") ?? "";
  return purpose.toLowerCase().includes("prefetch");
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/next && npx vitest run tests/prefetch.test.ts
```

Expected: PASS, 8 Tests.

- [ ] **Step 5: Commit**

```bash
git add packages/next/src/prefetch.ts packages/next/tests/prefetch.test.ts
git commit -m "feat(auth): add a prefetch-request predicate"
```

---

### Task 2: `emporixSiteProxy` schreibt auf Prefetch keine Cookies

**Files:**
- Modify: `packages/next/src/proxy.ts` (Import oben, plus die `Set-Cookie`-Schleife am Ende der Funktion)
- Test: `packages/next/tests/proxy.test.ts` (zwei Tests anfügen)

**Interfaces:**
- Consumes: `isPrefetchRequest` aus Task 1
- Produces: keine Signaturänderung. `emporixSiteProxy(request, site, rewriteTo?)` bleibt exakt wie es ist — nur das Verhalten bei Prefetch ändert sich.

- [ ] **Step 1: Write the failing tests**

Am Ende von `packages/next/tests/proxy.test.ts`, **innerhalb** des bestehenden `describe("emporixSiteProxy", …)`-Blocks, anfügen:

```ts
  it("schreibt auf einem Prefetch kein Set-Cookie", () => {
    // Ein Hover ueber einen Link in der anderen Sprache darf die Sprache des
    // Besuchers nicht umstellen.
    const request = new NextRequest("https://shop.test/en/x", {
      headers: { cookie: `${LANG}=de`, "Next-Router-Prefetch": "1" },
    });
    const response = emporixSiteProxy(request, { siteCode: "main", language: "en" });
    expect(response.cookies.get(LANG)).toBeUndefined();
    expect(response.cookies.get(SITE)).toBeUndefined();
  });

  it("injiziert auf einem Prefetch trotzdem in die weitergeleiteten Request-Cookies", () => {
    // Der spekulative Render soll die Sprache der angefragten URL benutzen — das
    // ist per Request und persistiert nichts.
    const request = new NextRequest("https://shop.test/en/x", {
      headers: { cookie: `${LANG}=de`, "Next-Router-Prefetch": "1" },
    });
    emporixSiteProxy(request, { siteCode: "main", language: "en" });
    expect(request.headers.get("cookie") ?? "").toContain(`${LANG}=en`);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/next && npx vitest run tests/proxy.test.ts
```

Expected: der erste neue Test FAIL (`response.cookies.get(LANG)` liefert `en` statt `undefined`), der zweite PASS (die Injektion gibt es schon).

- [ ] **Step 3: Write minimal implementation**

In `packages/next/src/proxy.ts` den Import ergänzen — direkt unter der bestehenden `STORAGE_KEYS`-Zeile:

```ts
import { isPrefetchRequest } from "./prefetch";
```

Dann die `Set-Cookie`-Schleife am Ende der Funktion. Vorher:

```ts
  for (const [name, value] of changed) {
    response.cookies.set(name, value, {
```

Nachher — eine Klammer davor, Kommentar und Bedingung:

```ts
  // Ein Prefetch ist eine Vermutung des Browsers. Er darf den Besucherzustand
  // nicht anfassen: sonst wechselt ein Hover ueber einen Link in der anderen
  // Sprache die Sprache. Die Injektion in die weitergeleiteten Request-Cookies
  // oben bleibt — die ist per Request und persistiert nichts, und der
  // spekulative Render soll die Sprache seiner URL benutzen.
  if (isPrefetchRequest(request)) return response;

  for (const [name, value] of changed) {
    response.cookies.set(name, value, {
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/next && npx vitest run tests/proxy.test.ts
```

Expected: PASS, 12 Tests (10 bestehende plus 2 neue).

- [ ] **Step 5: Commit**

```bash
git add packages/next/src/proxy.ts packages/next/tests/proxy.test.ts
git commit -m "fix(auth): stop the site proxy writing cookies on a prefetch"
```

---

### Task 3: `emporixTokenProxy` rotiert auf Prefetch nicht — plus Doku, Changeset und Live-Abnahme

**Files:**
- Modify: `packages/next/src/token-proxy.ts` (Import oben, plus ein früher Ausstieg vor dem Rotationsblock)
- Test: `packages/next/tests/token-proxy.test.ts` (zwei Tests anfügen)
- Modify: `packages/next/README.md` (Abschnitte bei Zeile 272 und 774)
- Create: `.changeset/prefetch-guard-proxy.md`

**Interfaces:**
- Consumes: `isPrefetchRequest` aus Task 1
- Produces: keine Signaturänderung. `emporixTokenProxy(request, opts?)` bleibt wie es ist.

- [ ] **Step 1: Write the failing tests**

Am Ende von `packages/next/tests/token-proxy.test.ts`, **innerhalb** des bestehenden `describe("emporixTokenProxy", …)`-Blocks, anfügen:

```ts
  it("rotiert auf einem Prefetch nicht, auch wenn der Token stale ist", async () => {
    // Ein Hover ueber ein Raster darf keinen Schwung Auth-Aufrufe an Emporix
    // ausloesen — und parallele Prefetches wuerden denselben Refresh-Token
    // mehrfach einloesen.
    const request = new NextRequest("https://shop.test/", {
      headers: {
        cookie: `${TOKEN}=${OPAQUE}; ${EXPIRES}=${expiresIn(30)}`,
        "Next-Router-Prefetch": "1",
      },
    });
    await emporixTokenProxy(request);
    expect(refreshCalls).toHaveLength(0);
  });

  it("rotiert bei einer echten clientseitigen Navigation weiter", async () => {
    // Die Falle, gegen die dieser Test schuetzt: `RSC: 1` sendet JEDE
    // clientseitige Navigation. Wuerde der Guard darauf hoeren, faende gar keine
    // Rotation mehr statt.
    const request = new NextRequest("https://shop.test/", {
      headers: { cookie: `${TOKEN}=${OPAQUE}; ${EXPIRES}=${expiresIn(30)}`, RSC: "1" },
    });
    await emporixTokenProxy(request);
    expect(refreshCalls).toHaveLength(1);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/next && npx vitest run tests/token-proxy.test.ts
```

Expected: der erste neue Test FAIL (`refreshCalls` hat Länge 1 statt 0), der zweite PASS.

- [ ] **Step 3: Write minimal implementation**

In `packages/next/src/token-proxy.ts` den Import ergänzen — direkt unter der bestehenden `emporixSiteProxy`-Import-Zeile:

```ts
import { isPrefetchRequest } from "./prefetch";
```

Dann den Rotationsblock gattern. Der bestehende Code lautet:

```ts
  if (token !== null) {
    const exp = storedExpiry(expiryRaw ?? undefined);
```

Daraus wird:

```ts
  // Auf einem Prefetch wird nicht rotiert. Ein Prefetch ist eine Vermutung des
  // Browsers: ein Refresh dafuer kostet einen Emporix-Auth-Aufruf fuer eine Seite,
  // die niemand anklickt, und `emporixRefresh` hat keine Entdopplung — parallele
  // Prefetches loesen denselben Refresh-Token mehrfach ein, und landet ein bereits
  // invalidierter als letzter im Cookie, bricht die Sitzung. Eine echte Navigation
  // rotiert weiter; `isPrefetchRequest` hoert bewusst nicht auf `RSC`.
  if (token !== null && !isPrefetchRequest(request)) {
    const exp = storedExpiry(expiryRaw ?? undefined);
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/next && npx vitest run tests/token-proxy.test.ts
```

Expected: PASS, 16 Tests (14 bestehende plus 2 neue).

- [ ] **Step 5: Run the whole package suite**

```bash
cd packages/next && npx vitest run
```

Expected: PASS, 15 Testdateien, 250 Tests (238 bestehende plus 12 neue: 8 in `prefetch.test.ts`, 2 in `proxy.test.ts`, 2 in `token-proxy.test.ts`).

- [ ] **Step 6: Update the README**

In `packages/next/README.md`, im Abschnitt «Token rotation belongs in the proxy» (ab Zeile 272) am Ende des Abschnitts anfügen:

```markdown
Prefetch requests are exempt. A `<Link>` prefetch is the browser guessing, not
the visitor acting: rotating for it spends an Emporix auth call on a page nobody
opened, and `emporixRefresh` has no de-duplication, so a burst of parallel
prefetches would redeem the same refresh token several times over. Detection
reads `Next-Router-Prefetch`, `Sec-Purpose` and `purpose` — deliberately **not**
`RSC`, which every client-side navigation sends.
```

Im Abschnitt «Site and locale detection (`proxy.ts`)» (ab Zeile 774) am Ende anfügen:

```markdown
On a prefetch, `emporixSiteProxy` writes no `Set-Cookie`. Without that, hovering a
link in the other language would switch the visitor's language. The forwarded
request cookies are still injected, so the speculative render uses the language of
the URL it was asked for.
```

- [ ] **Step 7: Write the changeset**

Create `.changeset/prefetch-guard-proxy.md`:

```markdown
---
"@viu/emporix-sdk-next": patch
---

Der Proxy verändert auf einem Prefetch-Request keinen Besucherzustand mehr.
`emporixTokenProxy` rotiert den Customer-Token nicht, `emporixSiteProxy` schreibt
kein `Set-Cookie` für Site und Sprache. Ohne das löste ein `<Link>`-Prefetch
Emporix-Auth-Aufrufe für Seiten aus, die niemand öffnet — und weil `emporixRefresh`
keine Entdopplung hat, lösten parallele Prefetches denselben Refresh-Token mehrfach
ein. Ein Hover über einen Link in der anderen Sprache stellte ausserdem die Sprache
des Besuchers um. Erkannt wird über `Next-Router-Prefetch`, `Sec-Purpose` und
`purpose`, bewusst nicht über `RSC` — den Header sendet jede clientseitige
Navigation.
```

- [ ] **Step 8: Live-Abnahme gegen das Beispiel**

Das Beispiel typecheckt und läuft gegen das gebaute `dist/`, also zuerst bauen:

```bash
pnpm -F @viu/emporix-sdk-next build
```

Dann das Beispiel bauen und starten:

```bash
cd examples/next-server-first && npx next build && npx next start -p 3000
```

In einer zweiten Shell — **ohne** Prefetch-Header muss ein Sprachwechsel per URL geschrieben werden:

```bash
curl -s -D - -o /dev/null -H 'cookie: emporix.language=de' http://localhost:3000/en | grep -i 'set-cookie.*language'
```

Expected: eine Zeile mit `emporix.language=en`.

**Mit** Prefetch-Header darf nichts geschrieben werden:

```bash
curl -s -D - -o /dev/null -H 'cookie: emporix.language=de' -H 'Next-Router-Prefetch: 1' -H 'RSC: 1' http://localhost:3000/en | grep -ci 'set-cookie.*language'
```

Expected: `0`.

Server danach stoppen:

```bash
pkill -f "next start"
```

- [ ] **Step 9: Repo-weite Verifikation**

```bash
pnpm -r test && pnpm typecheck && pnpm -r lint
```

Expected: alle Testdateien grün (sdk 155, react 68, next 15, mixins 9, examples 6), Typecheck 10/10, Lint ohne Fehler.

```bash
pnpm changeset status --since=origin/main
```

Expected: `@viu/emporix-sdk-next` erscheint als Patch-Bump.

- [ ] **Step 10: Commit**

```bash
git add packages/next/src/token-proxy.ts packages/next/tests/token-proxy.test.ts \
        packages/next/README.md .changeset/prefetch-guard-proxy.md
git commit -m "fix(auth): skip token rotation on prefetch requests"
```

---

## Self-Review

**Spec coverage.** Die zwei Schäden aus «Warum das nötig ist» sind gedeckt: Token-Rotation in Task 3, Sprach-Cookie in Task 2. Das gemeinsame Prädikat in Task 1. Die `RSC`-Falle aus den Global Constraints hat in Task 1 und Task 3 je einen eigenen Test. Die Entdopplung von `emporixRefresh` ist ausdrücklich ausgeschlossen und als Folge-Item vermerkt.

**Placeholder-Durchsicht.** Jeder Code-Schritt enthält den fertigen Text, jeder Test-Schritt die vollständige Assertion, jeder Run-Schritt den Befehl und die erwartete Ausgabe. Keine «ähnlich wie Task N»-Verweise: die zwei Import-Zeilen sind in Task 2 und 3 einzeln ausgeschrieben.

**Typkonsistenz.** `isPrefetchRequest` heisst in Task 1 (Definition), Task 2 und Task 3 identisch, nimmt überall denselben strukturellen Parameter und gibt `boolean`. Die Testzahlen kumulativ: `proxy.test.ts` 10 → 12, `token-proxy.test.ts` 14 → 16, `prefetch.test.ts` 8 neu; Paket 238 → 250.

## Vorbedingung: vor der Ausführung gemessen (2026-08-05)

Der Plan trug diese Prüfung ursprünglich als Schritt 8 von Task 3 — also erst nach dem Code. Vorgezogen, weil sie entscheidet, ob die Arbeit überhaupt etwas bewirkt. Gegen `next start` auf dem Stand von `main` (Merge #233):

```
curl -H 'cookie: emporix.language=de' \
     -H 'Next-Router-Prefetch: 1' -H 'RSC: 1' http://localhost:3000/en

HTTP/1.1 200 OK
set-cookie: emporix.language=en; Path=/; Max-Age=31536000; SameSite=lax
x-nextjs-cache: HIT
x-nextjs-prerender: 1
```

**Die Middleware läuft auf dem Prefetch-Request und schreibt das Cookie — obwohl die Seite aus dem Cache kommt.** Der Schaden «ein Hover über einen Link in der anderen Sprache stellt die Sprache um» ist damit belegt und nicht vermutet. Schritt 8 von Task 3 bleibt als Nachweis, dass der Guard genau diese Zeile zum Verschwinden bringt.
