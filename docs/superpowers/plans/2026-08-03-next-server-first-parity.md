# next-server-first auf Muster-Parität — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `examples/next-server-first` bekommt 13 Routen und deckt jedes
Muster ab, das `examples/storefront-demo` mit React-Query-Hooks löst — nur
server-first, plus ein Paket-Fehler aus #198 vorweg.

**Architecture:** Ein neues Workspace-Paket `examples/shared` hält die
Emporix-Formnormalisierung, die beide Demos brauchen (verschoben aus
storefront-demo, nicht kopiert). Die Next-Demo liest in Server Components und
schreibt in Server Actions; die Shell kostet null Emporix-Aufrufe, weil die
Warenkorb-Zählung in der Session mitläuft. Fehler kommen aus Actions **zurück**
statt geworfen zu werden, und eine einzige Client-Komponente zeigt sie an.

**Tech Stack:** Next 16 App Router, React 19 (`useActionState`),
`@viu/emporix-sdk-next/session`, Vitest für das Paket, Redis in Podman für den
Store-Modus.

**Spec:** `docs/superpowers/specs/2026-08-03-next-server-first-parity-design.md`

## Global Constraints

- **Commitlint:** Scope aus `repo, release, sdk, react, core, customer, product, category, cart, checkout, payment, price, media, segment, availability, auth, http, logger, deps, docs, examples`. Es gibt **kein** `next`-Scope — Paket-Änderungen laufen unter `repo`. Erstes Wort nach dem Scope ist ein **kleingeschriebenes Verb**.
- **Examples typechecken gegen `dist/`.** Nach jeder Änderung an SDK- oder React-Quellen: `pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build` **vor** dem Typecheck der Examples.
- **Examples haben keine Unit-Tests.** `test` und `lint` sind bewusste No-ops. Verifikation ist Typecheck, Build und Ausführen. Unit-Tests entstehen nur in Task 0 (`packages/next`) und Task 4.1 (`safeNext`).
- **`.env*` ist ausserhalb der Schreibrechte des Assistenten.** Neue Variablen werden im README dokumentiert; `.env.example` ergänzt der Mensch.
- **Kein Cookie wird direkt gelesen.** Immer über `sessionCookieJar` — roher `cookies()`-Zugriff umgeht den `__Host-`-Präfix und den Verschlüsselungs-Codec.
- **`STORE_OPT` an jeden Leser.** `withEmporixSession*`, `emporixTokenProxy`, `emporixSession`. Eine vergessene Stelle fällt still in den Cookie-Modus zurück.
- **`exactOptionalPropertyTypes` ist an.** Optionale Felder werden konditional gespreizt (`...(x !== undefined ? { x } : {})`), nicht mit `undefined` belegt.
- Nie «ß», immer «ss». Prosa in Schweizer Hochdeutsch, Code und Identifier englisch wie im Repo.

## Gemessene Signaturen

Alles hier ist am 2026-08-03 aus den Quellen gelesen, nicht erinnert. Tasks
verweisen darauf statt zu raten.

| Aufruf | Signatur |
|---|---|
| `client.categories.get` | `(categoryId, auth) => Promise<Category>` |
| `client.categories.subcategories` | `(categoryId, { pageNumber?, pageSize? }, auth) => Promise<Category[]>` |
| `client.categories.productsIn` | `(categoryId, { pageNumber?, pageSize? }, auth) => Promise<PaginatedItems<Product>>` — hat `hasNextPage` |
| `client.products.get` | `(productId, undefined, auth) => Promise<Product>` |
| `client.products.searchByName` | `(term, { pageNumber?, pageSize? }, auth) => Promise<PaginatedItems<Product>>` |
| `client.products.searchByIds` | `(ids, { chunkSize? }, auth) => Promise<Product[]>` |
| `client.products.listVariantChildren` | `(parentVariantId, { pageSize? }, auth) => Promise<Product[]>` |
| `client.prices.matchByContext` | `(input, auth) => Promise<PriceMatch[]>` |
| `client.carts.get` | `(cartId, auth) => Promise<Cart>` |
| `client.carts.getCurrent` | `(auth, { siteCode, create }) => Promise<Cart>` — `.id` |
| `client.carts.addItem` | `(cartId, input, auth)` |
| `client.carts.updateItem` | `(cartId, itemId, patch, auth, { partial: true })` |
| `client.carts.removeItem` | `(cartId, itemId, auth)` |
| `client.carts.applyCoupon` / `.removeCoupon` | `(cartId, code, auth)` |
| `client.carts.addItemsBatch` | `(cartId, body, auth)` |
| `client.customers.me` | `(auth) => Promise<Customer>` |
| `client.customers.update` | `(patch: CustomerUpdateInput, auth) => Promise<Customer>` |
| `client.customers.changePassword` | `(input: PasswordChangeInput, auth) => Promise<void>` |
| `client.customers.addresses.list` | `(auth)` |
| `client.customers.addresses.add` | `(input, auth)` |
| `client.customers.addresses.update` | `(id, patch, auth)` |
| `client.customers.addresses.remove` | `(id, auth)` |
| `client.orders.listMine` | `(auth, { pageNumber?, pageSize? }) => Promise<PaginatedItems<Order>>` |
| `client.orders.get` | `(orderId, auth)` |
| `client.orders.cancel` | `(orderId, auth, { saasToken? })` |

## Dateistruktur

**Neu — `examples/shared/`**

| Datei | Verantwortung |
|---|---|
| `package.json` | `@viu/emporix-examples-shared`, `private: true`, kein `build` (Quell-Import über `exports: { ".": "./src/index.ts" }`) |
| `src/index.ts` | Re-Export von `adapters.ts` und `format.ts` |
| `src/adapters.ts` | verschoben aus `storefront-demo/src/lib/adapters.ts`, ohne `sanitizeHtml`/`productDescription`, mit exportiertem `stripHtml` |
| `src/format.ts` | verschoben aus `storefront-demo/src/lib/format.ts` |
| `README.md` | «copy this» — es ist ein Helfer-Satz, keine Demo |

**Geändert — `examples/storefront-demo/`**

| Datei | Änderung |
|---|---|
| `src/lib/adapters.ts` | schrumpft auf `sanitizeHtml` + `productDescription`, re-exportiert den Rest aus dem geteilten Paket |
| `src/lib/format.ts` | gelöscht, Importe zeigen aufs Paket |
| `package.json` | Dependency `@viu/emporix-examples-shared: workspace:*` |

**Neu — `examples/next-server-first/app/`**

| Datei | Verantwortung |
|---|---|
| `lib/cart-session.ts` | `setCart`, `cartCount` — der einzige Schreiber der Cart-Id |
| `lib/require-customer.ts` | `requireCustomer`, `safeNext` |
| `lib/prices.ts` | `pricesFor(client, auth, products)` — serverseitiges Pendant zu `usePrices` |
| `lib/product-names.ts` | `namesFor(client, auth, ids)` — Pendant zu `useProductNames` |
| `components/action-form.tsx` | `ActionForm` — die einzige Client-Komponente für Formulare |
| `components/product-grid.tsx` | serverseitiges Produktgitter |
| `components/header.tsx` | Shell-Kopf, server-gerendert |
| `search/page.tsx`, `category/[id]/page.tsx`, `product/[id]/page.tsx` | Katalog |
| `account/page.tsx`, `account/profile/page.tsx`, `account/addresses/page.tsx`, `account/orders/page.tsx`, `account/orders/[id]/page.tsx` | Konto |
| `actions/account.ts` | Profil, Passwort, Adress-CRUD, Cancel, Reorder |
| `api/emporix/webhook/route.ts` | Task 5.1 |
| `styles/tokens.css`, `styles/global.css` | kopiert aus storefront-demo |

---

## Task 0: `opts.store` an die drei Jar-Konstruktionen in `session-auth.ts`

Ein Fehler aus #198. Blockiert Task 4.*. Läuft allein als eigene PR, damit die
Changeset-Korrektur nicht in einer Feature-PR untergeht.

**Files:**
- Modify: `packages/next/src/session-auth.ts:66`, `:151`, `:229`
- Modify: `.changeset/next-session-store.md`
- Test: `packages/next/tests/session-auth.test.ts`

**Interfaces:**
- Consumes: `sessionCookieJar(opts: { readOnly?: boolean; store?: EmporixSessionStore })` aus `session-cookies.ts`; `EmporixSessionStore` mit `read`/`write`/`destroy` aus `session-store.ts`.
- Produces: nichts Neues. Verhalten von `emporixLogin`, `emporixRefresh`, `emporixLogout` im Store-Modus.

- [ ] **Step 1: Bestehende Testdatei ansehen und den Fake-Store-Helfer schreiben**

Zuerst `packages/next/tests/session-auth.test.ts` lesen, um Mock-Aufbau und
MSW-Handler des Repos zu übernehmen. Dann diesen Helfer in dieselbe Datei:

```ts
import type { EmporixSessionStore } from "../src/session-store";

/** Ein Store, der mitschreibt, was er tut — das ist der Beleg, nicht der Inhalt. */
function fakeStore(): EmporixSessionStore & {
  records: Map<string, Record<string, string>>;
  destroyed: string[];
} {
  const records = new Map<string, Record<string, string>>();
  const destroyed: string[] = [];
  return {
    records,
    destroyed,
    read: async (id) => records.get(id) ?? null,
    write: async (id, record) => {
      records.set(id, { ...record });
    },
    destroy: async (id) => {
      destroyed.push(id);
      records.delete(id);
    },
  };
}
```

- [ ] **Step 2: Die drei fehlschlagenden Tests schreiben**

```ts
import { STORAGE_KEYS } from "@viu/emporix-sdk-react/ssr";
import { SESSION_SID } from "../src/session-store";

it("emporixLogin with a store keeps the customer token OUT of the browser", async () => {
  const store = fakeStore();
  await emporixLogin({ email: "a@b.ch", password: "x" }, { store, ...BASE_OPTS });

  // Der Beleg ist zweiseitig: nicht im Cookie UND im Record. Nur eine Hälfte
  // zu prüfen liesse den Cookie-Zweig durchgehen.
  expect(cookieJar.get(STORAGE_KEYS.customerToken)).toBeUndefined();
  const record = [...store.records.values()][0];
  expect(record?.[STORAGE_KEYS.customerToken]).toBeTypeOf("string");
});

it("emporixRefresh with a store writes the rotated token into the record", async () => {
  const store = fakeStore();
  const sid = "sid-under-test";
  store.records.set(sid, { [STORAGE_KEYS.refreshToken]: "old-refresh" });
  cookieJar.set(SESSION_SID, sid);

  await emporixRefresh({ store, ...BASE_OPTS });

  expect(store.records.get(sid)?.[STORAGE_KEYS.customerToken]).toBeTypeOf("string");
  expect(cookieJar.get(STORAGE_KEYS.customerToken)).toBeUndefined();
});

it("emporixLogout with a store destroys the record", async () => {
  const store = fakeStore();
  const sid = "sid-to-destroy";
  store.records.set(sid, { [STORAGE_KEYS.customerToken]: "tok" });
  cookieJar.set(SESSION_SID, sid);

  await emporixLogout({ store, ...BASE_OPTS });

  expect(store.destroyed).toEqual([sid]);
  expect(store.records.has(sid)).toBe(false);
});
```

`BASE_OPTS` und `cookieJar` aus der bestehenden Datei übernehmen — sie hat
beides schon, weil die Cookie-Modus-Tests darauf laufen.

- [ ] **Step 3: Tests laufen lassen — sie MÜSSEN rot sein**

Run: `pnpm -F @viu/emporix-sdk-next test -- session-auth`
Expected: **alle drei FAIL**. Erwartet: Test 1 findet einen `customerToken` im
Cookie-Jar; Test 2 findet den Record unverändert; Test 3 findet
`store.destroyed` leer.

Ist einer grün, ist der Test falsch, nicht der Code. Dann stimmt der Aufbau von
`cookieJar`/`BASE_OPTS` nicht — nachsehen, bevor es weitergeht.

- [ ] **Step 4: Den Fix an den drei Stellen anwenden**

An `session-auth.ts:66`, `:151` und `:229` jeweils:

```ts
const jar = await sessionCookieJar(opts.store !== undefined ? { store: opts.store } : {});
```

`{ store: opts.store }` direkt geht nicht: `exactOptionalPropertyTypes` verbietet
das Zuweisen von `undefined` an ein optionales Feld.

- [ ] **Step 5: Tests laufen lassen — jetzt grün, und der Rest auch**

Run: `pnpm -F @viu/emporix-sdk-next test`
Expected: PASS, 203 Tests (200 bestehende plus drei neue). Kein bestehender Test
darf kippen — die Cookie-Modus-Tests übergeben kein `store` und laufen
unverändert durch denselben Zweig.

- [ ] **Step 6: Changeset-Korrektur**

In `.changeset/next-session-store.md` ist die Zeile «`emporixLogout` destroys the
record» ausgeliefert worden, ohne dass es stimmte. Das Changeset ist mit #198
schon veröffentlicht, also kommt die Korrektur in ein **neues** Changeset:

```bash
cat > .changeset/next-store-auth-threading.md <<'EOF'
---
"@viu/emporix-sdk-next": patch
---

Fixes store mode for logged-in customers. `emporixLogin`, `emporixRefresh` and
`emporixLogout` built their cookie jar without the `store` option, so in store
mode they silently used cookies.

The effect was not a leak but a break: login wrote `customerToken`,
`refreshToken` and `saasToken` into real browser cookies, while
`emporixSession({ store })` read the store record — which had none of them — and
reported the visitor as anonymous. Logged in, and every reader said logged out.

`emporixLogout` hit the cookie-mode no-op, so the store record survived the
logout. The 0.4.0 release notes claimed it destroyed the record. It did not.

Guest mode was never affected: it runs through `withEmporixSessionMutable`,
which threads the option correctly.
EOF
```

- [ ] **Step 7: Live-Beleg im Store-Modus**

Redis muss laufen (`podman ps` zeigt den Container auf 6379).

```bash
pnpm -F @viu/emporix-sdk-next build && pnpm -F @viu/emporix-examples-next-server-first dev
```

Mit `EMPORIX_SESSION_REDIS_URL` gesetzt: auf `/login` anmelden (der Mensch tippt
das Passwort), dann prüfen:

```bash
node -e "const {createClient}=require('redis');(async()=>{const c=createClient({url:'redis://127.0.0.1:6379'});await c.connect();for(const k of await c.keys('emporix:session:*'))console.log(k,await c.ttl(k),await c.get(k));await c.quit();})()"
```

Erwartet: der Record enthält `emporix.customerToken`, und `/debug` zeigt im
Browser **nur** `emporix.sid` und `emporix.siteCode`. Danach ausloggen und die
Key-Liste erneut abfragen — der Key ist weg.

- [ ] **Step 8: Commit**

```bash
git add packages/next/src/session-auth.ts packages/next/tests/session-auth.test.ts .changeset/next-store-auth-threading.md
git commit -m "fix(repo): thread the session store through login, refresh and logout"
```

---

## Task 1.1: `examples/shared` anlegen und die Adapter verschieben

**Files:**
- Create: `examples/shared/package.json`, `examples/shared/tsconfig.json`, `examples/shared/src/index.ts`, `examples/shared/src/adapters.ts`, `examples/shared/src/format.ts`, `examples/shared/README.md`
- Modify: `examples/storefront-demo/src/lib/adapters.ts`, `examples/storefront-demo/package.json`
- Delete: `examples/storefront-demo/src/lib/format.ts`
- Modify: `examples/README.md`

**Interfaces:**
- Produces: `@viu/emporix-examples-shared` exportiert `localized`, `pickText`, `stripHtml`, `imageOf`, `toProductCard`, `ProductCardVM`, `productName`, `productImages`, `priceMatchItems`, `PriceVM`, `priceForProduct`, `productYrn`, `catLabel`, `catId`, `CartLinePrice`, `CartLineVM`, `toCartLine`, `cartLines`, `cartTotal`, `cartCoupons`, `OrderVM`, `orderVM`, `OrderItemVM`, `orderItems`, `money`.
- storefront-demo behält lokal: `sanitizeHtml`, `productDescription`.

- [ ] **Step 1: Paket-Manifest**

Kein Build-Schritt: das Paket wird als Quelle importiert. Deshalb zeigt
`exports` direkt auf `src/`.

```json
{
  "name": "@viu/emporix-examples-shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "echo \"no tests — see examples/README.md\"",
    "lint": "echo \"no lint — see examples/README.md\""
  },
  "dependencies": { "@viu/emporix-sdk": "workspace:*" }
}
```

`test` und `lint` als No-op mit erklärender Ausgabe, wie die anderen Examples es
halten — `pnpm -r test` läuft sonst ins Leere und man rätselt, warum.

`tsconfig.json` aus `examples/node-server/tsconfig.json` kopieren; es ist das
Example ohne React und passt deshalb.

- [ ] **Step 2: Dateien verschieben**

```bash
git mv examples/storefront-demo/src/lib/adapters.ts examples/shared/src/adapters.ts
git mv examples/storefront-demo/src/lib/format.ts examples/shared/src/format.ts
```

`git mv` statt Kopieren, damit die Historie mitkommt.

- [ ] **Step 3: `sanitizeHtml` und `productDescription` aus dem Paket herausnehmen, `stripHtml` exportieren**

In `examples/shared/src/adapters.ts` die beiden Funktionen `sanitizeHtml` und
`productDescription` **löschen** und bei `stripHtml` das `export` ergänzen:

```ts
/**
 * Tag-Strip ohne DOM. Reine String-Arbeit, läuft deshalb auch in Node — was
 * `sanitizeHtml` nicht tut, weil es `DOMParser` braucht. Server-gerenderte
 * Consumer bekommen Klartext statt Markup, und das ist der ehrliche Handel.
 */
export function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
```

Der Datei-Kopfkommentar «View-model adapters — the SINGLE place that reads
SDK/generated field names» bleibt und wird jetzt wieder wahr. Ergänzen:

```ts
/**
 * Geteilt von examples/storefront-demo und examples/next-server-first. Wer
 * einen eigenen Storefront baut: kopieren. Das ist keine veröffentlichte API.
 */
```

- [ ] **Step 4: `src/index.ts`**

```ts
export * from "./adapters";
export * from "./format";
```

- [ ] **Step 5: storefront-demo umstellen**

`examples/storefront-demo/src/lib/adapters.ts` neu anlegen — nur noch die zwei
browsergebundenen Funktionen plus ein Re-Export, damit die 30+ bestehenden
Importpfade unverändert bleiben:

```ts
import type { Product } from "@viu/emporix-sdk";
import { pickText, stripHtml } from "@viu/emporix-examples-shared";

/** Alles Formnormalisierende liegt im geteilten Paket. Hier bleibt nur, was einen Browser braucht. */
export * from "@viu/emporix-examples-shared";

const UNSAFE_TAGS = "script,style,iframe,object,embed,link,meta,base,form,input,template";

/**
 * Sanitize merchant-authored description HTML for safe rendering. Keeps the
 * markup but drops script/style/embeds, `on*` handlers and `javascript:` URLs,
 * and hardens links. Uses the browser DOMParser — no dependency, but browser
 * only, which is why this did not move into the shared package.
 * For untrusted / user-generated HTML prefer a vetted sanitizer (e.g. DOMPurify).
 */
export function sanitizeHtml(html: string): string {
  if (typeof DOMParser === "undefined") return stripHtml(html);
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll(UNSAFE_TAGS).forEach((el) => el.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || /^\s*javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
    if (el.tagName === "A" && el.getAttribute("href")) {
      el.setAttribute("rel", "noopener noreferrer nofollow");
      el.setAttribute("target", "_blank");
    }
  });
  return doc.body.innerHTML.trim();
}

/** Product description as sanitized HTML, ready for `dangerouslySetInnerHTML`. */
export function productDescription(p: Product): string {
  return sanitizeHtml(pickText((p as { description?: unknown }).description, ""));
}
```

Dann in `examples/storefront-demo/package.json` die Dependency ergänzen:
`"@viu/emporix-examples-shared": "workspace:*"`.

Die vier Dateien, die `../lib/format` importieren, auf
`@viu/emporix-examples-shared` umstellen:

```bash
grep -rln 'lib/format' examples/storefront-demo/src
```

- [ ] **Step 6: Der Regressionsbeleg**

```bash
pnpm install
pnpm -F @viu/emporix-examples-shared typecheck
pnpm -F @viu/emporix-examples-storefront-demo typecheck
pnpm -F @viu/emporix-examples-storefront-demo build
```

Expected: alle drei grün. Dann die Demo starten und **von Hand** durchgehen:
Startseite mit Preisen, ein Produkt öffnen, in den Warenkorb, `/cart` mit
Summe, `/account/orders` mit einer Bestellung. Das ist die Abnahmebedingung
dieses Tasks — ein Typecheck beweist bei `as`-lastigen Adaptern zu wenig.

- [ ] **Step 7: `examples/README.md` korrigieren**

Drei Änderungen:

1. Zeile 42: «checkout, account and B2B» → «checkout and account». storefront-demo hat kein B2B; Grep findet nur einen Telemetrie-Event-Namen, den nichts auslöst.
2. Die Zeile «It states the cost in numbers and shows what a full storefront would need» ersatzlos streichen — diesen Abschnitt gibt es im README der Demo nicht.
3. Nach der Fünf-Demo-Tabelle einen Absatz:

```markdown
## `shared/` ist keine Demo

`examples/shared` ist ein unveröffentlichtes Workspace-Paket mit der
Emporix-Formnormalisierung, die `storefront-demo` und `next-server-first`
beide brauchen — Bestellungen kommen in zwei Formen zurück, Warenkorbzeilen
wollen ihre Preiszeile beim Update zurück, Textfelder sind mal ein String und
mal eine Locale-Map. Wer einen eigenen Storefront baut, kopiert die Dateien;
sie sind bewusst nicht Teil der veröffentlichten API.
```

- [ ] **Step 8: Commit**

```bash
git add examples/shared examples/storefront-demo examples/README.md pnpm-lock.yaml
git commit -m "refactor(examples): move the shape adapters into a shared package"
```

---

## Task 1.2: Shell, CSS und die Warenkorb-Zählung in der Session

**Files:**
- Create: `examples/next-server-first/app/lib/cart-session.ts`, `app/components/header.tsx`, `app/styles/tokens.css`, `app/styles/global.css`
- Modify: `examples/next-server-first/app/layout.tsx`, `app/actions/cart.ts`, `app/actions/checkout.ts`, `app/package.json`
- Modify: `examples/next-server-first/README.md`

**Interfaces:**
- Consumes: `@viu/emporix-examples-shared` (Task 1.1); `sessionCookieJar`, `STORAGE_KEYS`, `SESSION_MAX_AGE`, `SessionCookieJar`, `emporixSession` aus `@viu/emporix-sdk-next/session`.
- Produces: `setCart(jar, cart | null): void` und `cartCount(jar): number` aus `app/lib/cart-session.ts`. Ab hier schreibt **niemand** `STORAGE_KEYS.cartId` mehr direkt.

- [ ] **Step 1: CSS kopieren**

```bash
mkdir -p examples/next-server-first/app/styles
cp examples/storefront-demo/src/styles/tokens.css examples/next-server-first/app/styles/tokens.css
cp examples/storefront-demo/src/styles/global.css examples/next-server-first/app/styles/global.css
```

Kopiert, **nicht** geteilt. Geteilt hiesse: eine Änderung in storefront-demos CSS
lässt diese Demo kaputt aussehen, ohne dass ein Test es merkt. Kopiert driften
sie optisch auseinander und nichts bricht. Oben in beide Dateien:

```css
/* Kopiert aus examples/storefront-demo/src/styles/ am 2026-08-03. Absichtlich
   eine Kopie: eine geteilte Datei hätte die zwei Demos aneinandergekoppelt. */
```

`catalog.css` bleibt draussen — es gehört zu Komponenten, die diese Demo nicht
hat.

- [ ] **Step 2: `cart-session.ts`**

```ts
import {
  SESSION_MAX_AGE,
  STORAGE_KEYS,
  type SessionCookieJar,
} from "@viu/emporix-sdk-next/session";

const COUNT = "demo.cartCount";

/**
 * Die EINZIGE Stelle, die die Cart-Id schreibt.
 *
 * Die Zählung liegt daneben in der Session, damit die Shell sie ohne
 * Emporix-Aufruf zeigen kann: ein Badge im Layout hiesse sonst pro
 * Seitenaufruf ein `withEmporixSession`, und der Gast-Pfad baut dort
 * absichtlich einen neuen Client pro Aufruf. Wäre die Zählung woanders
 * schreibbar, könnte sie driften; so kann sie es strukturell nicht.
 */
export function setCart(
  jar: SessionCookieJar,
  cart: { id?: string; items?: unknown[] } | null,
): void {
  const id = cart?.id;
  if (cart === null || id === undefined) {
    jar.delete(STORAGE_KEYS.cartId);
    jar.delete(COUNT);
    return;
  }
  jar.set(STORAGE_KEYS.cartId, id, SESSION_MAX_AGE.cartId);
  jar.set(COUNT, String(cart.items?.length ?? 0), SESSION_MAX_AGE.cartId);
}

export function cartCount(jar: SessionCookieJar): number {
  // Ohne Cart-Id ist eine Zählung bedeutungslos, und das deckt den Logout ab:
  // SESSION_COOKIES in session-auth.ts ist eine feste Liste, unser Demo-Key
  // steht nicht drin und würde den Logout sonst überleben.
  if (jar.get(STORAGE_KEYS.cartId) === null) return 0;
  // `Number.isInteger`, nicht ein Wahrheitstest: `Number(null)` ist 0 und nicht
  // NaN — derselbe Stolperstein wie bei SESSION_STARTED_AT.
  const n = Number(jar.get(COUNT));
  return Number.isInteger(n) && n > 0 ? n : 0;
}
```

- [ ] **Step 3: `header.tsx`**

Server-Komponente. Das Suchfeld ist ein reines GET-Formular — storefront-demos
Header hält den Text in `useState` und navigiert programmatisch; hier braucht es
dafür kein JavaScript.

```tsx
import { emporixSession, sessionCookieJar } from "@viu/emporix-sdk-next/session";
import { STORE_OPT } from "../emporix";
import { cartCount } from "../lib/cart-session";
import { logout } from "../actions/auth";

export async function Header(): Promise<React.JSX.Element> {
  const jar = await sessionCookieJar({ readOnly: true, ...STORE_OPT });
  const { customerToken } = await emporixSession(STORE_OPT);
  const count = cartCount(jar);

  return (
    <header style={{ borderBottom: "1px solid var(--line)" }}>
      <div className="container cluster" style={{ gap: "var(--s-5)", paddingBlock: "var(--s-4)" }}>
        <a href="/" className="serif">Server—First</a>
        {/* Kein onSubmit, kein useState: ein GET-Formular navigiert selbst. */}
        <form action="/search" method="get" style={{ flex: 1, maxWidth: "26rem" }}>
          <input className="input" type="search" name="q" placeholder="Search the catalogue…" aria-label="Search products" />
        </form>
        <nav className="cluster" style={{ gap: "var(--s-4)", marginLeft: "auto" }}>
          <a href="/cart" className="u-underline">Cart{count > 0 ? ` (${count})` : ""}</a>
          {customerToken === null ? (
            <a href="/login" className="u-underline">Login</a>
          ) : (
            <>
              <a href="/account" className="u-underline">Account</a>
              <form action={logout} style={{ display: "inline" }}>
                <button type="submit" className="btn btn--ghost btn--sm">Logout</button>
              </form>
            </>
          )}
          <a href="/debug" className="u-underline">Debug</a>
        </nav>
      </div>
    </header>
  );
}
```

`app/actions/auth.ts` exportiert `login(formData: FormData): Promise<void>` und
`logout(): Promise<void>` — beide Namen sind gemessen, nicht geraten.

- [ ] **Step 4: `layout.tsx` umbauen**

```tsx
import type { ReactNode } from "react";
import "./styles/tokens.css";
import "./styles/global.css";
import { Header } from "./components/header";

export const metadata = { title: "Emporix SDK — server-first example" };

/**
 * Kein Provider, kein client-seitiger EmporixClient, kein Storage. Diese
 * Abwesenheit IST die Demonstration. Der Header ist eine Server-Komponente und
 * macht keinen einzigen Emporix-Aufruf — die Warenkorb-Zählung liegt in der
 * Session.
 */
export default function RootLayout({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <html lang="en">
      <body>
        <Header />
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Die bestehenden Schreibstellen auf `setCart` umstellen**

In `app/actions/cart.ts` den Block ersetzen:

```ts
    let cartId = jar.get(STORAGE_KEYS.cartId);
    if (cartId === null) {
      const cart = await client.carts.getCurrent(ctx, { siteCode: SITE.siteCode, create: true });
      cartId = cart?.id ?? null;
      if (cartId === null) throw new Error("Emporix returned no cart");
      setCart(jar, cart);
    }
    await client.carts.addItem(cartId, { /* unverändert */ }, ctx);
    // Emporix gibt den Warenkorb bei addItem nicht zurück, also einmal lesen —
    // die Zählung im Header muss nach dem Hinzufügen stimmen.
    setCart(jar, await client.carts.get(cartId, ctx));
```

In `app/actions/checkout.ts` das Löschen des Warenkorbs nach der Bestellung auf
`setCart(sessionJar, null)` umstellen — heute wird dort `STORAGE_KEYS.cartId`
direkt gelöscht, was die Zählung stehen liesse.

**Achtung:** `client.carts.getCurrent` gibt einen `Cart` mit `.id`,
`client.carts.create` einen `CartCreated` mit `.cartId`. `setCart` liest `.id` —
`create` würde still eine Zählung ohne Id schreiben.

- [ ] **Step 6: Der Login-Pfad**

`emporixLogin` führt das Cart-Onboarding im Paket durch und schreibt dabei
`STORAGE_KEYS.cartId` selbst — ausserhalb von `setCart`. Nach dem Login ist die
Zählung deshalb die des Gast-Warenkorbs, nicht die des zusammengeführten.

Fix in `app/actions/auth.ts`, direkt nach `emporixLogin`:

```ts
  // emporixLogin führt Gast- und Kundenwarenkorb zusammen und schreibt die
  // Cart-Id im Paket, also ausserhalb von setCart. Die Zählung danach einmal
  // nachziehen, sonst zeigt der Header die Zahl von vor dem Merge.
  await withEmporixSessionMutable(async (client, ctx, jar) => {
    const cartId = jar.get(STORAGE_KEYS.cartId);
    if (cartId !== null) setCart(jar, await client.carts.get(cartId, ctx));
  }, EMPORIX);
```

- [ ] **Step 7: Typecheck und Live-Beleg**

```bash
pnpm -F @viu/emporix-examples-next-server-first typecheck
pnpm -F @viu/emporix-examples-next-server-first dev
```

Erwartet, im Browser mit offenem Netzwerk-Tab:

| Prüfung | Erwartung |
|---|---|
| Startseite laden | Header gestylt, «Cart» ohne Zahl |
| «Add to cart», dann Startseite neu laden | «Cart (1)», und **kein** Emporix-Request beim Laden der Startseite |
| `/debug` | PASS, nur `emporix.siteCode` lesbar (bzw. `emporix.sid` im Store-Modus) |
| Anmelden mit einem Gast-Warenkorb | Zählung stimmt mit `/cart` überein |
| Abmelden | «Cart» ohne Zahl |

Die zweite Zeile ist der eigentliche Beleg dieses Tasks. Erscheint beim Laden
der Startseite ein Token- oder Cart-Request, greift `cartCount` nicht und der
Header liest doch über Emporix.

- [ ] **Step 8: README-Abschnitt**

In `examples/next-server-first/README.md` nach «The catalog/cart split»:

```markdown
## Die Shell kostet null Emporix-Aufrufe

Ein Warenkorb-Badge im Layout wäre pro Seitenaufruf ein `withEmporixSession`,
und der Gast-Pfad baut dort absichtlich einen neuen Client pro Aufruf — ein
geteilter Guest-Client wäre ein geteilter Warenkorb. Dazu kann ein read-only
Jar eine rotierte anonyme Session nicht persistieren, also würde die
Wiederverwendung des Refresh-Tokens von «drei Reads auf /cart» auf «jeder
Seitenaufruf» skalieren.

Die Zählung liegt deshalb neben der Cart-Id in der Session, geschrieben von
genau einer Funktion (`app/lib/cart-session.ts`). Das ist eine
Denormalisierung mit bekannter Obergrenze: wer die Cart-Id direkt schreibt,
statt `setCart` zu nehmen, lässt den Badge driften.
```

- [ ] **Step 9: Commit**

```bash
git add examples/next-server-first
git commit -m "feat(examples): add a server-rendered shell to the next demo"
```

---

## Task 6.1: Sprach- und Site-Umschalter in der Shell

> **Reihenfolge: dieser Task läuft ZULETZT, nach Task 5.1.** Er steht hier, weil
> er zur Shell aus Task 1.2 gehört, aber er **löscht** `CONTEXT` und `EMPORIX`
> aus `app/emporix.ts` — und die Tasks 2.1 bis 4.4 benutzen beide. Vorgezogen
> bricht er jede Seite, die danach noch geschrieben wird. Als eigene, siebte PR.

Die Spec führt ihn in Muster 1 als eine Nebenklausel. Er ist grösser als das:
`CONTEXT` in `app/emporix.ts` ist eine Modulkonstante, die **jeder** Leser
bindet — Katalogseiten über `getEmporixClient({ context: CONTEXT })` und alle
Session-Aufrufe über `EMPORIX`. Ein Umschalter heisst, das aus der Session
abzuleiten.

Die gute Nachricht steht in
[client.ts:113](../../../packages/next/src/client.ts#L113): der
Memoisierungs-Key enthält den Kontext, ein Kontext pro Besucherwahl ergibt also
eine eigene Client-Instanz und **kein** Leck zwischen Besuchern. Der Kommentar
dort sagt «the context is written once per app, in one place» — genau diese
Annahme bricht dieser Task, und die Map wächst danach mit der Zahl distinkter
Kontexte. Bei zwei oder drei Sites ist das begrenzt und in Ordnung; die Zeile
gehört korrigiert.

**Files:**
- Create: `examples/next-server-first/app/lib/site-context.ts`, `app/actions/site.ts`, `app/components/site-switcher.tsx`
- Modify: `app/emporix.ts`, `app/components/header.tsx`, `app/page.tsx`, `app/search/page.tsx`, `app/category/[id]/page.tsx`, `app/product/[id]/page.tsx`
- Modify: `packages/next/src/client.ts:110-112` (Kommentar), `examples/next-server-first/README.md`

**Interfaces:**
- Produces: `siteContext(): Promise<{ siteCode: string; currency: string; targetLocation: string; language?: string }>` und `emporixOptions(): Promise<WithEmporixSessionOptions>` aus `app/lib/site-context.ts`; `switchLanguage`, und — abhängig von Step 1 — `switchSite` aus `app/actions/site.ts`.

- [ ] **Step 1: Messen, wie viele Sites der Tenant hat — das entscheidet den Rest**

```bash
pnpm -F @viu/emporix-examples-next-server-first dev
```

Dann eine Wegwerf-Route oder das bestehende `/debug` nutzen, um
`client.sites.list(undefined)` zu rendern. `sites.list(auth)` und
`sites.listCodes(auth)` existieren beide.

**Ist genau eine Site konfiguriert** (auf dem `viu`-Tenant ist `main` die, die
der Proxy pinnt): ein Site-Umschalter mit einem Eintrag demonstriert nichts und
lässt sich nicht verifizieren. Dann fällt der **Site**-Teil weg und dieser Task
liefert nur den **Sprach**-Umschalter — Sprache ist eine freie Wahl und nicht
tenant-konfiguriert, also prüfbar. Im README wird die Verengung mit dem Grund
festgehalten, nach derselben Regel, die `/reset-password` ausschliesst: was
nicht verifizierbar ist, wird hier nicht behauptet.

**Sind es zwei oder mehr:** Steps 2–7 wie geschrieben, plus Step 8.

Das Ergebnis dieser Messung in den Commit-Text schreiben. Ohne sie ist der Rest
des Tasks Spekulation.

- [ ] **Step 2: `lib/site-context.ts`**

```ts
import { sessionCookieJar, STORAGE_KEYS, type WithEmporixSessionOptions } from "@viu/emporix-sdk-next/session";
import { SESSION_STORE, STORE_OPT } from "../emporix";

/** Die Vorgabe, wenn der Besucher nichts gewählt hat. Bisher war das CONTEXT. */
const DEFAULTS = { siteCode: "main", currency: "CHF", targetLocation: "CH" } as const;

/**
 * Der Kontext für diesen Request, aus der Session abgeleitet statt aus einer
 * Modulkonstante. `siteCode` und `language` sind PUBLIC session keys — sie
 * liegen auch im Store-Modus als gewöhnliche Cookies und sind für JavaScript
 * lesbar. Das ist Absicht: es sind Anzeigeeinstellungen, keine Geheimnisse.
 */
export async function siteContext(): Promise<{
  siteCode: string;
  currency: string;
  targetLocation: string;
  language?: string;
}> {
  const jar = await sessionCookieJar({ readOnly: true, ...STORE_OPT });
  const language = jar.get(STORAGE_KEYS.language);
  return {
    siteCode: jar.get(STORAGE_KEYS.siteCode) ?? DEFAULTS.siteCode,
    currency: DEFAULTS.currency,
    targetLocation: DEFAULTS.targetLocation,
    ...(language !== null ? { language } : {}),
  };
}

/** Dasselbe für die Session-Aufrufe. Ersetzt das exportierte `EMPORIX`. */
export async function emporixOptions(): Promise<WithEmporixSessionOptions> {
  return {
    context: await siteContext(),
    ...(SESSION_STORE !== undefined ? { store: SESSION_STORE } : {}),
  };
}
```

Bei mehreren Sites kommt die Währung aus der gewählten Site statt aus
`DEFAULTS` — dann in `siteContext` ein `client.sites.get(siteCode, undefined)`
ergänzen und die Währung daraus lesen.

- [ ] **Step 3: `actions/site.ts`**

```ts
"use server";
import { revalidatePath } from "next/cache";
import { SESSION_MAX_AGE, STORAGE_KEYS, sessionCookieJar } from "@viu/emporix-sdk-next/session";
import { STORE_OPT } from "../emporix";
import type { ActionState } from "../components/action-form";

/** Die Sprachen, die die Demo anbietet. Frei gewählt, nicht tenant-konfiguriert. */
export const LANGUAGES = ["en", "de"] as const;

export async function switchLanguage(_state: ActionState, form: FormData): Promise<ActionState> {
  const language = String(form.get("language"));
  // Allowlist, kein Freitext: der Wert landet in einem Cookie und von dort in
  // jedem Emporix-Request als Header.
  if (!LANGUAGES.includes(language as (typeof LANGUAGES)[number])) {
    return { error: "Unsupported language" };
  }
  const jar = await sessionCookieJar(STORE_OPT);
  jar.set(STORAGE_KEYS.language, language, SESSION_MAX_AGE.siteCode);
  await jar.flush();
  // "layout", nicht nur die Seite: die Sprache betrifft jede serverseitige
  // Lesung, auch die im Header.
  revalidatePath("/", "layout");
  return { error: null };
}
```

`SESSION_MAX_AGE.siteCode` prüfen — heisst der Schlüssel dort anders, den
tatsächlichen nehmen; `SESSION_MAX_AGE` wird aus `@viu/emporix-sdk-next/session`
exportiert.

- [ ] **Step 4: `components/site-switcher.tsx`**

Server-Komponente, ein Formular pro Sprache — so bleibt es ohne JavaScript
bedienbar und braucht kein `<select onChange>`.

```tsx
import { STORAGE_KEYS, sessionCookieJar } from "@viu/emporix-sdk-next/session";
import { STORE_OPT } from "../emporix";
import { LANGUAGES, switchLanguage } from "../actions/site";
import { ActionForm } from "./action-form";

export async function SiteSwitcher(): Promise<React.JSX.Element> {
  const jar = await sessionCookieJar({ readOnly: true, ...STORE_OPT });
  const active = jar.get(STORAGE_KEYS.language) ?? "en";

  return (
    <span className="cluster" style={{ gap: "var(--s-2)" }}>
      {LANGUAGES.map((l) => (
        <ActionForm key={l} action={switchLanguage} submit={l === active ? `${l} ●` : l}>
          <input type="hidden" name="language" value={l} />
        </ActionForm>
      ))}
    </span>
  );
}
```

- [ ] **Step 5: Jeden Leser auf den Sitzungskontext umstellen**

```bash
grep -rn 'CONTEXT\|EMPORIX\b' examples/next-server-first/app
```

Jede Stelle `getEmporixClient({ context: CONTEXT })` → `getEmporixClient({ context: await siteContext() })`,
jede Stelle `EMPORIX` → `await emporixOptions()`. Dann `CONTEXT` und `EMPORIX`
aus `app/emporix.ts` **löschen**, damit keine Stelle zurückfallen kann. `SITE`,
`SESSION_STORE`, `STORE_OPT` und `PRICED_CATEGORY` bleiben.

`<SiteSwitcher />` in `components/header.tsx` in die `<nav>` einsetzen, vor
`Cart`.

- [ ] **Step 6: Den falschen Kommentar im Paket korrigieren**

`packages/next/src/client.ts`, der Block über dem Memoisierungs-Key:

```ts
  // JSON.stringify is key-order-dependent, so the same context written with its
  // fields in a different order yields a second instance. Wasteful, not wrong.
  // Note the map grows with the number of DISTINCT contexts, not with requests —
  // an app that lets visitors switch site or language will hold one client per
  // combination. Bounded by the configuration, not by traffic.
```

- [ ] **Step 7: Typecheck und Live-Beleg**

```bash
pnpm -F @viu/emporix-examples-next-server-first typecheck
```

| Prüfung | Erwartung |
|---|---|
| «de» klicken | Der aktive Marker wandert, die Seite lädt neu |
| Netzwerk-Tab beim nächsten Katalog-Request | der Emporix-Request trägt die neue Sprache |
| Produktname mit deutscher Lokalisierung | zeigt die deutsche Variante, falls der Tenant eine hat |
| Cookies | `emporix.language` ist da und **für JavaScript lesbar** — anders als die Token, und das ist Absicht |
| `/debug` | bleibt PASS: ein lesbares `emporix.language` ist kein Geheimnis |

Die vierte Zeile ist der Punkt, an dem man `/debug` falsch verstehen könnte —
grün heisst «keine Token lesbar», nicht «keine Cookies lesbar». Falls `/debug`
über eine Allowlist prüft, muss `emporix.language` dort hinein.

Hat der Tenant keine deutschen Lokalisierungen, ist Zeile 3 nicht prüfbar. Dann
Zeile 2 als Beleg nehmen und im README festhalten, dass der Effekt auf die
Anzeige von den Tenant-Daten abhängt.

- [ ] **Step 8: Nur bei zwei oder mehr Sites — Warenkorb mitziehen**

Ein Site- oder Währungswechsel bindet den anonymen Token nicht neu; Emporix hat
für den Warenkorb eigene Operationen. Nach dem Schreiben des `siteCode`:

```ts
  await withEmporixSessionMutable(async (client, ctx, jar) => {
    const cartId = jar.get(STORAGE_KEYS.cartId);
    if (cartId === null) return;
    // changeSite/changeCurrency existieren, WEIL ein neu gebundener Kontext den
    // bestehenden Warenkorb nicht mitnimmt. Ohne diesen Schritt zeigt der
    // Warenkorb weiter die alte Währung.
    await client.carts.changeSite(cartId, siteCode, ctx);
    setCart(jar, await client.carts.get(cartId, ctx));
  }, await emporixOptions());
```

Beleg: Artikel im Warenkorb, Site wechseln, `/cart` öffnen — Währung und Summe
sind die der neuen Site.

- [ ] **Step 9: Commit**

```bash
git add examples/next-server-first packages/next/src/client.ts
git commit -m "feat(examples): derive the emporix context from the session"
```

Braucht ein Changeset? Nein — die Änderung an `client.ts` ist ein Kommentar.

---

## Task 2.1: `/search`

**Files:**
- Create: `examples/next-server-first/app/search/page.tsx`, `app/components/product-grid.tsx`, `app/lib/prices.ts`
- Modify: `examples/next-server-first/app/page.tsx`

**Interfaces:**
- Consumes: `toProductCard`, `ProductCardVM`, `PriceVM`, `priceForProduct`, `priceMatchItems`, `money` aus `@viu/emporix-examples-shared`.
- Produces: `pricesFor(client, auth, products): Promise<(id: string) => PriceVM | undefined>` aus `app/lib/prices.ts`; `ProductGrid` aus `app/components/product-grid.tsx`.

- [ ] **Step 1: `lib/prices.ts`**

Serverseitiges Pendant zu `usePrices` — dieselbe Logik, ohne React Query.

```ts
import type { AuthContext, EmporixClient, Product } from "@viu/emporix-sdk";
import { priceForProduct, priceMatchItems, type PriceVM } from "@viu/emporix-examples-shared";

/**
 * Löst die Preise für einen Satz Produkte in EINEM Aufruf auf und gibt eine
 * Nachschlagefunktion zurück. Ein Aufruf pro Produkt wäre N Requests pro Seite.
 */
export async function pricesFor(
  client: EmporixClient,
  auth: AuthContext | undefined,
  products: Product[],
): Promise<(id: string) => PriceVM | undefined> {
  const items = priceMatchItems(products);
  if (items.length === 0) return () => undefined;
  const matches = await client.prices.matchByContext({ items }, auth);
  return (id) => priceForProduct(matches, id);
}
```

- [ ] **Step 2: `components/product-grid.tsx`**

```tsx
import { money, toProductCard, type PriceVM } from "@viu/emporix-examples-shared";
import type { Product } from "@viu/emporix-sdk";
import { addToCart } from "../actions/cart";

/** Server-Komponente. Die Klassennamen kommen aus dem kopierten CSS. */
export function ProductGrid({
  products,
  priceOf,
}: {
  products: Product[];
  priceOf: (id: string) => PriceVM | undefined;
}): React.JSX.Element {
  async function add(formData: FormData): Promise<void> {
    "use server";
    await addToCart(String(formData.get("productId")));
  }

  return (
    <ul className="grid" style={{ listStyle: "none", padding: 0 }}>
      {products.map((p) => {
        const vm = toProductCard(p);
        const price = priceOf(vm.id);
        return (
          <li key={vm.id} className="pc">
            <a href={`/product/${encodeURIComponent(vm.id)}`}>
              {vm.image ? <img src={vm.image} alt={vm.imageAlt} /> : <div className="pc__ph" />}
              <span className="serif">{vm.name}</span>
            </a>
            {price ? <p className="price">{money(price.amount, price.currency)}</p> : null}
            <form action={add}>
              <input type="hidden" name="productId" value={vm.id} />
              <button type="submit" className="btn btn--sm">Add to cart</button>
            </form>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 3: `search/page.tsx`**

```tsx
import { getEmporixClient } from "@viu/emporix-sdk-next";
import { CONTEXT } from "../emporix";
import { ProductGrid } from "../components/product-grid";
import { pricesFor } from "../lib/prices";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}): Promise<React.JSX.Element> {
  const q = ((await searchParams).q ?? "").trim();
  const client = getEmporixClient({ context: CONTEXT });
  // searchByName baut den Emporix-Filter `name:(~…)` und escaped die
  // Regex-Metazeichen — deshalb hier kein eigenes Quoting.
  const page = q === "" ? null : await client.products.searchByName(q, { pageSize: 24 }, undefined);
  const priceOf = await pricesFor(client, undefined, page?.items ?? []);

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <p className="eyebrow">Search</p>
      <h2 className="serif">{q === "" ? "Search the catalogue" : `«${q}»`}</h2>
      {page === null ? (
        <p className="muted">Type a query in the header.</p>
      ) : page.items.length === 0 ? (
        <p className="muted">Nothing found for «{q}».</p>
      ) : (
        <ProductGrid products={page.items} priceOf={priceOf} />
      )}
    </main>
  );
}
```

- [ ] **Step 4: Startseite auf `ProductGrid` umstellen**

`app/page.tsx` behält seinen Katalog-Aufruf und ersetzt die `<ul>` durch
`<ProductGrid products={page.items} priceOf={priceOf} />` samt
`const priceOf = await pricesFor(client, undefined, page.items)`. Die lokale
`label()`-Funktion fällt weg — `toProductCard` im Gitter macht das.

- [ ] **Step 5: Typecheck und Live-Beleg**

```bash
pnpm -F @viu/emporix-examples-next-server-first typecheck
```

Dann im Browser: im Header «shirt» (oder einen Begriff, den die Startseite
zeigt) eingeben und absenden. Erwartet: URL ist `/search?q=shirt`, Treffer mit
Preisen, «Add to cart» erhöht den Badge. Leere Suche zeigt den Hinweistext.

- [ ] **Step 6: Commit**

```bash
git add examples/next-server-first
git commit -m "feat(examples): add server-rendered search to the next demo"
```

---

## Task 2.2: `/category/[id]` mit Pagination über die URL

**Files:**
- Create: `examples/next-server-first/app/category/[id]/page.tsx`

**Interfaces:**
- Consumes: `ProductGrid`, `pricesFor` (Task 2.1); `catLabel`, `catId` aus `@viu/emporix-examples-shared`.

- [ ] **Step 1: Die Seite**

```tsx
import { getEmporixClient } from "@viu/emporix-sdk-next";
import { catId, catLabel } from "@viu/emporix-examples-shared";
import { CONTEXT } from "../../emporix";
import { ProductGrid } from "../../components/product-grid";
import { pricesFor } from "../../lib/prices";

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  // `Number(undefined) || 1` ergibt 1, `Number("abc") || 1` ergibt 1, und
  // Math.max fängt Negatives. Die Grenze wird gezogen, ohne Framework.
  const page = Math.max(1, Number((await searchParams).page) || 1);

  const client = getEmporixClient({ context: CONTEXT });
  const [category, subs, products] = await Promise.all([
    client.categories.get(id, undefined),
    client.categories.subcategories(id, { pageSize: 50 }, undefined),
    client.categories.productsIn(id, { pageNumber: page, pageSize: 24 }, undefined),
  ]);
  const priceOf = await pricesFor(client, undefined, products.items);
  const href = (n: number): string => `/category/${encodeURIComponent(id)}?page=${n}`;

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <p className="eyebrow">Category</p>
      <h2 className="serif">{catLabel(category)}</h2>

      {subs.length > 0 ? (
        <nav className="catnav" aria-label="Subcategories">
          {subs.map((s) => (
            <a key={catId(s)} href={`/category/${encodeURIComponent(catId(s))}`} className="u-underline">
              {catLabel(s)}
            </a>
          ))}
        </nav>
      ) : null}

      {products.items.length === 0 ? (
        // Eine reine Elternkategorie hat nur Unterkategorien — die Kacheln oben
        // sind dann die Antwort, nicht eine leere Meldung.
        subs.length > 0 ? null : <p className="muted">No products in this category.</p>
      ) : (
        <>
          <ProductGrid products={products.items} priceOf={priceOf} />
          {/* Blättern, nicht anhängen: Akkumulieren wie useInfiniteQuery
              bräuchte Client-State, und den gibt es in diesem Modus nicht. */}
          <nav className="cluster" style={{ gap: "var(--s-4)", marginTop: "var(--s-6)" }}>
            {page > 1 ? <a href={href(page - 1)} className="btn btn--outline">← Previous</a> : null}
            <span className="muted">Page {page}</span>
            {products.hasNextPage ? <a href={href(page + 1)} className="btn btn--outline">Next →</a> : null}
          </nav>
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Typecheck und Live-Beleg**

```bash
pnpm -F @viu/emporix-examples-next-server-first typecheck
```

`PRICED_CATEGORY` aus `app/emporix.ts` hat 11 Produkte — zu wenig für eine
zweite Seite. Für den Beleg deshalb `pageSize` temporär auf 5 setzen, blättern,
zurückblättern, und den Wert wieder auf 24 stellen.

Erwartet: Seite 2 zeigt andere Produkte, «Previous» erscheint erst ab Seite 2,
«Next» verschwindet auf der letzten Seite. `?page=0` und `?page=abc` landen auf
Seite 1, `?page=-5` ebenfalls.

- [ ] **Step 3: Commit**

```bash
git add examples/next-server-first
git commit -m "feat(examples): add a paginated category page to the next demo"
```

---

## Task 2.3: `/product/[id]` mit Varianten

**Files:**
- Create: `examples/next-server-first/app/product/[id]/page.tsx`

**Interfaces:**
- Consumes: `pricesFor` (Task 2.1); `productName`, `productImages`, `imageOf`, `stripHtml`, `pickText`, `money` aus `@viu/emporix-examples-shared`; `addToCart` aus `app/actions/cart.ts`.

- [ ] **Step 1: Die Seite**

```tsx
import { getEmporixClient } from "@viu/emporix-sdk-next";
import { imageOf, money, pickText, productImages, productName, stripHtml } from "@viu/emporix-examples-shared";
import { CONTEXT } from "../../emporix";
import { pricesFor } from "../../lib/prices";
import { addToCart } from "../../actions/cart";

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ variant?: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const chosen = (await searchParams).variant;
  const client = getEmporixClient({ context: CONTEXT });

  const parent = await client.products.get(id, undefined, undefined);
  // Kinder sind leer, wenn das Produkt kein PARENT_VARIANT ist — der Aufruf ist
  // dann verschenkt, aber billiger als eine Typprüfung über die fünf
  // Produktformen der Emporix-Union.
  const children = await client.products.listVariantChildren(id, { pageSize: 50 }, undefined);
  const selected =
    children.find((c) => (c as { id?: string }).id === chosen) ?? (children[0] ?? parent);
  const selectedId = (selected as { id?: string }).id ?? id;

  const priceOf = await pricesFor(client, undefined, [selected]);
  const price = priceOf(selectedId);
  const name = productName(parent);
  // stripHtml, nicht sanitizeHtml: `DOMParser` gibt es in Node nicht. Die
  // Beschreibung kommt hier als Klartext, nicht als Markup — siehe README.
  const description = stripHtml(pickText((parent as { description?: unknown }).description, ""));

  async function add(formData: FormData): Promise<void> {
    "use server";
    await addToCart(String(formData.get("productId")));
  }

  return (
    <main className="container pdp" style={{ paddingBlock: "var(--s-6)" }}>
      <p><a href="/" className="eyebrow u-underline">← Catalogue</a></p>
      <div className="pdp__grid">
        <div>
          {productImages(parent).map((m, i) => {
            const url = imageOf([m]);
            return url ? <img key={i} src={url} alt={name} style={{ maxWidth: "100%" }} /> : null;
          })}
        </div>
        <div className="pdp__info">
          <h1 className="serif">{name}</h1>
          {price ? <p className="price">{money(price.amount, price.currency)}</p> : null}
          {description !== "" ? <p className="muted" style={{ maxWidth: "52ch" }}>{description}</p> : null}

          {children.length > 0 ? (
            // Varianten über die URL, nicht über Client-State: jedes Kind ist
            // ein Link, und der gewählte ist ein teilbarer Zustand.
            <nav className="cluster" aria-label="Variants" style={{ gap: "var(--s-2)" }}>
              {children.map((c) => {
                const cid = (c as { id?: string }).id ?? "";
                return (
                  <a
                    key={cid}
                    href={`/product/${encodeURIComponent(id)}?variant=${encodeURIComponent(cid)}`}
                    className={cid === selectedId ? "tag tag--accent" : "tag"}
                  >
                    {productName(c)}
                  </a>
                );
              })}
            </nav>
          ) : null}

          <form action={add} style={{ marginTop: "var(--s-4)" }}>
            {/* Die gewählte Kind-Id, nicht die des Elternteils: ein
                PARENT_VARIANT ist nicht bestellbar. */}
            <input type="hidden" name="productId" value={selectedId} />
            <button type="submit" className="btn btn--accent">Add to cart</button>
          </form>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: README-Zeile zur Beschreibung**

In `examples/next-server-first/README.md` unter «Not every product has a price»
einen Absatz:

```markdown
## Produktbeschreibungen sind hier Klartext

storefront-demo rendert die händlergepflegte Beschreibung als HTML, gesäubert
über `DOMParser`. Den gibt es in Node nicht, also nimmt diese Demo `stripHtml`
aus `examples/shared` und zeigt Klartext. Ein Sanitizer mit Node-Pfad wäre eine
Abhängigkeit für eine Demo-Zeile — der falsche Handel.
```

- [ ] **Step 3: Typecheck und Live-Beleg**

Erwartet: ein Produkt aus dem Gitter öffnet, Name, Preis und Beschreibung
stehen da. Ein Produkt **mit** Varianten zeigt die Kacheln; ein Klick ändert die
URL auf `?variant=…`, markiert die gewählte und «Add to cart» legt die
**Variante** in den Warenkorb (in `/cart` an der `itemYrn` prüfen). Ein Produkt
**ohne** Varianten zeigt keine Kacheln und legt sich selbst in den Warenkorb.

- [ ] **Step 4: Commit**

```bash
git add examples/next-server-first
git commit -m "feat(examples): add a product page with variants to the next demo"
```

---

## Task 3.1: `ActionForm` und die Fehlerrückgabe

**Files:**
- Create: `examples/next-server-first/app/components/action-form.tsx`, `app/lib/describe-error.ts`
- Modify: `examples/next-server-first/app/actions/checkout.ts`

**Interfaces:**
- Produces: `ActionState = { error: string | null }`, `ActionForm({ action, submit, children })` aus `app/components/action-form.tsx`; `describeError(e: unknown): string` aus `app/lib/describe-error.ts`.
- Alle Actions ab Task 3.2 haben die Form `(state: ActionState, form: FormData) => Promise<ActionState>`.

- [ ] **Step 1: `describe-error.ts`**

`app/actions/checkout.ts` hat heute eine lokale `describe(e)`, die
`EmporixError.body` sichtbar macht — ohne sie kommt bei einem 400 nur «Request
failed» an. Die Funktion wird geteilt, statt sie ein zweites Mal zu schreiben.

Zuerst die bestehende Implementierung in `app/actions/checkout.ts` lesen und
**wörtlich** nach `app/lib/describe-error.ts` verschieben, als
`describeError` exportiert. Dann in `checkout.ts` importieren und die lokale
Kopie löschen.

- [ ] **Step 2: `action-form.tsx`**

```tsx
"use client";
import { useActionState } from "react";

export interface ActionState {
  error: string | null;
}

/**
 * Die einzige Client-Komponente für Formulare. `useActionState` verlangt eine,
 * aber nicht acht: der Action kommt als Prop rein (Server Actions sind
 * serialisierbar), und die Kinder bleiben serverseitig gerendert.
 *
 * Die Alternative — Redirect mit `?error=…` — bräuchte null Client-Komponenten,
 * schreibt aber Fehlertexte in teilbare URLs. Das ist ein Defekt, nicht nur
 * unschön.
 */
export function ActionForm({
  action,
  submit,
  children,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  submit: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form action={formAction}>
      {children}
      {state.error !== null ? (
        <p role="alert" className="muted" style={{ color: "var(--oxblood)" }}>
          {state.error}
        </p>
      ) : null}
      <button type="submit" className="btn btn--sm" disabled={pending}>
        {pending ? "…" : submit}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm -F @viu/emporix-examples-next-server-first typecheck
```

Erwartet: grün. `/checkout` muss unverändert funktionieren — der einzige
Eingriff dort war das Verschieben von `describe`.

- [ ] **Step 4: Commit**

```bash
git add examples/next-server-first
git commit -m "feat(examples): add one client form wrapper for action errors"
```

---

## Task 3.2: `/cart` mit Mengen, Entfernen, Coupon und Summen

**Files:**
- Create: `examples/next-server-first/app/lib/product-names.ts`
- Modify: `examples/next-server-first/app/cart/page.tsx`, `app/actions/cart.ts`

**Interfaces:**
- Consumes: `ActionForm`, `ActionState`, `describeError` (Task 3.1); `setCart` (Task 1.2); `cartLines`, `cartTotal`, `cartCoupons`, `money`, `productName` aus `@viu/emporix-examples-shared`.
- Produces: `namesFor(client, auth, ids): Promise<Record<string, string>>` aus `app/lib/product-names.ts`; die Actions `setQuantity`, `removeLine`, `applyCoupon`, `removeCoupon` aus `app/actions/cart.ts`.

- [ ] **Step 1: `lib/product-names.ts`**

```ts
import type { AuthContext, EmporixClient } from "@viu/emporix-sdk";
import { productName } from "@viu/emporix-examples-shared";

/**
 * Löst Anzeigenamen nach Produkt-Id auf. Warenkorbzeilen tragen nur ein
 * `itemYrn` — der Cart-GET liefert ein LEERES `product`, also gibt es keinen
 * Namen in der Antwort und er muss separat geholt werden.
 */
export async function namesFor(
  client: EmporixClient,
  auth: AuthContext | undefined,
  ids: string[],
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(ids.filter((x) => x !== "")));
  if (unique.length === 0) return {};
  const products = await client.products.searchByIds(unique, {}, auth);
  const map: Record<string, string> = {};
  for (const p of products) {
    const id = (p as { id?: string }).id;
    if (id !== undefined) map[id] = productName(p);
  }
  return map;
}
```

- [ ] **Step 2: Die vier Actions in `app/actions/cart.ts`**

Alle geben `ActionState` zurück statt zu werfen — das ist, was `ActionForm`
anzeigen kann. Alle laufen über `setCart`, damit der Badge stimmt.

```ts
import type { ActionState } from "../components/action-form";
import { describeError } from "../lib/describe-error";
import { setCart } from "../lib/cart-session";

/** Gemeinsamer Rahmen: Warenkorb holen, mutieren, Zählung nachziehen, Fehler zurückgeben. */
async function mutateCart(
  fn: (client: EmporixClient, ctx: AuthContext, cartId: string) => Promise<void>,
): Promise<ActionState> {
  try {
    await withEmporixSessionMutable(async (client, ctx, jar) => {
      const cartId = jar.get(STORAGE_KEYS.cartId);
      if (cartId === null) throw new Error("No cart");
      await fn(client, ctx, cartId);
      setCart(jar, await client.carts.get(cartId, ctx));
    }, EMPORIX);
  } catch (e) {
    return { error: describeError(e) };
  }
  revalidatePath("/cart");
  revalidatePath("/");
  return { error: null };
}

export async function setQuantity(_state: ActionState, form: FormData): Promise<ActionState> {
  "use server";
  const itemId = String(form.get("itemId"));
  const quantity = Number(form.get("quantity"));
  if (!Number.isInteger(quantity) || quantity < 1) return { error: "Quantity must be 1 or more" };
  return mutateCart((client, ctx, cartId) =>
    // `partial: true` → nur die Menge. Ohne das ersetzt PUT die ganze Zeile und
    // will itemYrn plus Preiszeile zurück.
    client.carts.updateItem(cartId, itemId, { quantity }, ctx, { partial: true }),
  );
}

export async function removeLine(_state: ActionState, form: FormData): Promise<ActionState> {
  "use server";
  const itemId = String(form.get("itemId"));
  return mutateCart((client, ctx, cartId) => client.carts.removeItem(cartId, itemId, ctx));
}

export async function applyCoupon(_state: ActionState, form: FormData): Promise<ActionState> {
  "use server";
  const code = String(form.get("code")).trim();
  if (code === "") return { error: "Enter a coupon code" };
  return mutateCart((client, ctx, cartId) => client.carts.applyCoupon(cartId, code, ctx));
}

export async function removeCoupon(_state: ActionState, form: FormData): Promise<ActionState> {
  "use server";
  const code = String(form.get("code"));
  return mutateCart((client, ctx, cartId) => client.carts.removeCoupon(cartId, code, ctx));
}
```

`EmporixClient` und `AuthContext` als Typimporte aus `@viu/emporix-sdk`
ergänzen.

- [ ] **Step 3: `cart/page.tsx` neu**

```tsx
import { STORAGE_KEYS, sessionCookieJar, withEmporixSession } from "@viu/emporix-sdk-next/session";
import { cartCoupons, cartLines, cartTotal, money } from "@viu/emporix-examples-shared";
import { EMPORIX, STORE_OPT } from "../emporix";
import { ActionForm } from "../components/action-form";
import { namesFor } from "../lib/product-names";
import { applyCoupon, removeCoupon, removeLine, setQuantity } from "../actions/cart";

export default async function CartPage(): Promise<React.JSX.Element> {
  // sessionCookieJar, nicht cookies(): der Präfix und der Codec hängen daran.
  const jar = await sessionCookieJar({ readOnly: true, ...STORE_OPT });
  const cartId = jar.get(STORAGE_KEYS.cartId);

  if (cartId === null) {
    return (
      <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
        <h1 className="serif">Cart</h1>
        <p className="muted">No cart yet. Add something from the <a href="/">catalog</a>.</p>
      </main>
    );
  }

  const { lines, total, coupons, names } = await withEmporixSession(async (client, ctx) => {
    const cart = await client.carts.get(cartId, ctx);
    const l = cartLines(cart);
    return {
      lines: l,
      total: cartTotal(cart),
      coupons: cartCoupons(cart),
      names: await namesFor(client, ctx, l.map((x) => x.productId)),
    };
  }, EMPORIX);

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <h1 className="serif">Your bag</h1>
      {/* Die Id ist httpOnly, nur der Server kann sie zeigen. Sie steht hier,
          weil ihr Wechsel über einen Login der einzige Beleg ist, dass das
          Cart-Onboarding den Gast-Warenkorb wirklich getauscht hat. */}
      <p className="muted">Cart <code>{cartId}</code></p>

      {lines.length === 0 ? (
        <p className="muted">Your bag is empty.</p>
      ) : (
        <ul className="cart__lines" style={{ listStyle: "none", padding: 0 }}>
          {lines.map((l) => (
            <li key={l.id} className="cart__line">
              <span className="serif">{names[l.productId] ?? l.productId}</span>
              <ActionForm action={setQuantity} submit="Update">
                <input type="hidden" name="itemId" value={l.id} />
                <label className="field__label" htmlFor={`qty-${l.id}`}>Quantity</label>
                <input id={`qty-${l.id}`} className="input" name="quantity" type="number" min={1} defaultValue={l.quantity} />
              </ActionForm>
              <ActionForm action={removeLine} submit="Remove">
                <input type="hidden" name="itemId" value={l.id} />
              </ActionForm>
              <span className="price">{l.lineTotal ? money(l.lineTotal.amount, l.lineTotal.currency) : ""}</span>
            </li>
          ))}
        </ul>
      )}

      <aside className="cart__summary surface">
        <h3 className="serif">Summary</h3>
        <ActionForm action={applyCoupon} submit="Apply">
          <label className="field__label" htmlFor="code">Coupon</label>
          <input id="code" className="input" name="code" placeholder="Code" />
        </ActionForm>
        {coupons.map((c) => (
          <ActionForm key={c} action={removeCoupon} submit={`Remove ${c}`}>
            <input type="hidden" name="code" value={c} />
          </ActionForm>
        ))}
        <div className="cart__total">
          <span className="eyebrow">Total</span>
          <span className="price">{total ? money(total.amount, total.currency) : "—"}</span>
        </div>
        {lines.length > 0 ? <a href="/checkout" className="btn btn--accent">Checkout →</a> : null}
      </aside>
    </main>
  );
}
```

- [ ] **Step 4: Typecheck und Live-Beleg**

| Prüfung | Erwartung |
|---|---|
| Produkt hinzufügen, `/cart` öffnen | Zeile mit **Namen** (nicht der Id), Einzel- und Zeilensumme |
| Menge auf 3, «Update» | Zeile zeigt 3, Zeilensumme verdreifacht, Badge zeigt weiter 1 Position |
| Menge auf 0, «Update» | «Quantity must be 1 or more», kein Request an Emporix |
| «Remove» | Zeile weg, Badge sinkt |
| Coupon «NOPE», «Apply» | Emporix-Meldung im Formular, nicht «Request failed» |
| Leerer Coupon | «Enter a coupon code» |

Zeile 3 und 6 sind der Beleg für die Fehlerrückgabe: ohne `ActionForm` würde
dort eine geworfene Exception die Next-Fehlerseite zeigen.

Die Namenszeile ist der Beleg für `namesFor` — der Cart-GET liefert ein leeres
`product`, also stünde ohne den zweiten Aufruf die nackte Id da.

- [ ] **Step 5: Commit**

```bash
git add examples/next-server-first
git commit -m "feat(examples): add cart mutations to the next demo"
```

---

## Task 4.1: Auth-Gate, `safeNext` und `/account`

**Braucht Task 0** — ohne den Store-Fix meldet `emporixSession` im Store-Modus
jeden angemeldeten Kunden als anonym, und das Gate leitet in einer Schleife um.

**Files:**
- Create: `examples/next-server-first/app/lib/require-customer.ts`, `app/account/page.tsx`
- Create: `examples/next-server-first/tests/safe-next.test.ts`
- Modify: `examples/next-server-first/app/login/page.tsx`, `app/actions/auth.ts`, `app/package.json`

**Interfaces:**
- Produces: `requireCustomer(next: string): Promise<string>` und `safeNext(raw: string | undefined): string` aus `app/lib/require-customer.ts`.

- [ ] **Step 1: Den fehlschlagenden Test für `safeNext`**

Die einzige Vertrauensgrenze in dieser Demo. Sie bekommt einen Test, obwohl
Examples sonst keine haben — eine offene Weiterleitung ist kein Demo-Detail.

`examples/next-server-first/package.json`: `"test": "vitest run"` statt des
No-ops, und `vitest` als devDependency. Dazu in `examples/README.md` unter
«Conventions» die Zeile «No unit tests» ergänzen um: «— ausser
`next-server-first/tests/safe-next.test.ts`, das eine offene Weiterleitung
abdeckt.»

```ts
import { describe, expect, it } from "vitest";
import { safeNext } from "../app/lib/require-customer";

describe("safeNext", () => {
  it("keeps a plain path", () => {
    expect(safeNext("/account/orders")).toBe("/account/orders");
  });
  it("rejects a protocol-relative absolute link", () => {
    // `//evil.com` ist KEIN Pfad — der Browser liest es als Absolutlink.
    expect(safeNext("//evil.com")).toBe("/");
  });
  it("rejects an absolute URL", () => {
    expect(safeNext("https://evil.com")).toBe("/");
  });
  it("falls back when absent", () => {
    expect(safeNext(undefined)).toBe("/");
  });
});
```

- [ ] **Step 2: Test laufen lassen — rot**

Run: `pnpm -F @viu/emporix-examples-next-server-first test`
Expected: FAIL, «Failed to resolve import» oder «safeNext is not a function».

- [ ] **Step 3: `lib/require-customer.ts`**

```ts
import { redirect } from "next/navigation";
import { emporixSession } from "@viu/emporix-sdk-next/session";
import { STORE_OPT } from "../emporix";

/**
 * Nur eigene Pfade. Eine offene Weiterleitung ist eine Vertrauensgrenze, auch
 * in einer Demo — `//evil.com` ist ein protokollrelativer Absolutlink und kein
 * Pfad, obwohl er mit einem Schrägstrich beginnt.
 */
export function safeNext(raw: string | undefined): string {
  if (raw === undefined || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

/**
 * Gate für Konto-Seiten. Pro Seite, nicht als Middleware: Next 16 führt
 * Middleware in `proxy.ts` aus, das Node-Runtime ist und kein `cookies()` hat.
 */
export async function requireCustomer(next: string): Promise<string> {
  const { customerToken } = await emporixSession(STORE_OPT);
  if (customerToken === null) redirect(`/login?next=${encodeURIComponent(next)}`);
  return customerToken;
}
```

- [ ] **Step 4: Test laufen lassen — grün**

Run: `pnpm -F @viu/emporix-examples-next-server-first test`
Expected: PASS, 4 Tests.

- [ ] **Step 5: `/login` honoriert `?next=`**

In `app/login/page.tsx` `searchParams` annehmen, `safeNext` darauf anwenden und
den Wert als `<input type="hidden" name="next" …>` mitschicken. In der
Login-Action in `app/actions/auth.ts` nach `emporixLogin` und dem
Zählungs-Nachzug aus Task 1.2:

```ts
  // safeNext auch hier, nicht nur beim Rendern: das Feld kommt aus dem Formular
  // und ist damit vom Client bestimmt.
  redirect(safeNext(String(form.get("next") ?? "/")));
```

- [ ] **Step 6: `/account`**

```tsx
import { withEmporixSession } from "@viu/emporix-sdk-next/session";
import { pickText } from "@viu/emporix-examples-shared";
import { EMPORIX } from "../emporix";
import { requireCustomer } from "../lib/require-customer";

export default async function AccountPage(): Promise<React.JSX.Element> {
  await requireCustomer("/account");
  const customer = await withEmporixSession((client, ctx) => client.customers.me(ctx), EMPORIX);

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <p className="eyebrow">Account</p>
      <h1 className="serif">
        {pickText((customer as { firstName?: unknown }).firstName, "")}{" "}
        {pickText((customer as { lastName?: unknown }).lastName, "")}
      </h1>
      <nav className="cluster" style={{ gap: "var(--s-4)" }}>
        <a href="/account/profile" className="u-underline">Profile</a>
        <a href="/account/addresses" className="u-underline">Addresses</a>
        <a href="/account/orders" className="u-underline">Orders</a>
      </nav>
    </main>
  );
}
```

- [ ] **Step 7: Live-Beleg**

Abgemeldet `/account` öffnen: Umleitung auf `/login?next=%2Faccount`. Anmelden:
zurück auf `/account` mit dem Namen. Dann `/login?next=//evil.com` öffnen,
anmelden — Landung auf `/`, nicht auf evil.com. Und einmal im Store-Modus mit
Redis, weil genau das ohne Task 0 in einer Umleitungsschleife endet.

- [ ] **Step 8: Commit**

```bash
git add examples/next-server-first examples/README.md
git commit -m "feat(examples): gate the account routes server-side"
```

---

## Task 4.2: `/account/profile` — Profil und Passwort

**Files:**
- Create: `examples/next-server-first/app/account/profile/page.tsx`, `app/actions/account.ts`

**Interfaces:**
- Consumes: `requireCustomer` (Task 4.1), `ActionForm`/`ActionState`/`describeError` (Task 3.1).
- Produces: `updateProfile`, `changePassword` aus `app/actions/account.ts`.

- [ ] **Step 1: Die zwei Actions**

```ts
"use server";
import { revalidatePath } from "next/cache";
import { withEmporixSessionMutable } from "@viu/emporix-sdk-next/session";
import { EMPORIX } from "../emporix";
import type { ActionState } from "../components/action-form";
import { describeError } from "../lib/describe-error";

export async function updateProfile(_state: ActionState, form: FormData): Promise<ActionState> {
  const firstName = String(form.get("firstName")).trim();
  const lastName = String(form.get("lastName")).trim();
  if (firstName === "" || lastName === "") return { error: "First and last name are required" };
  const contactEmail = String(form.get("contactEmail") ?? "").trim();
  const contactPhone = String(form.get("contactPhone") ?? "").trim();
  try {
    await withEmporixSessionMutable(
      (client, ctx) =>
        client.customers.update(
          {
            firstName,
            lastName,
            // exactOptionalPropertyTypes: leere Felder weglassen statt "" zu
            // senden — "" würde einen bestehenden Wert löschen.
            ...(contactEmail !== "" ? { contactEmail } : {}),
            ...(contactPhone !== "" ? { contactPhone } : {}),
          },
          ctx,
        ),
      EMPORIX,
    );
  } catch (e) {
    return { error: describeError(e) };
  }
  revalidatePath("/account");
  revalidatePath("/account/profile");
  return { error: null };
}

export async function changePassword(_state: ActionState, form: FormData): Promise<ActionState> {
  // `currentPassword`, NICHT `oldPassword` — gemessen an
  // storefront-demo/src/account/PasswordForm.tsx:23, wo der Aufruf live erprobt
  // ist. Der falsche Name ergibt einen 400 mit unklarem Body.
  const currentPassword = String(form.get("currentPassword"));
  const newPassword = String(form.get("newPassword"));
  if (newPassword.length < 8) return { error: "The new password needs at least 8 characters" };
  try {
    await withEmporixSessionMutable(
      (client, ctx) => client.customers.changePassword({ currentPassword, newPassword }, ctx),
      EMPORIX,
    );
  } catch (e) {
    return { error: describeError(e) };
  }
  // Kein revalidate: es gibt nichts anzuzeigen, was sich geändert hätte.
  return { error: null };
}
```

Die vier Profilfelder (`firstName`, `lastName`, `contactEmail`, `contactPhone`)
sind aus `storefront-demo/src/account/ProfileForm.tsx` gelesen — dieselbe Quelle,
die gegen den echten Tenant läuft. `CustomerUpdateInput` ist ein Alias auf das
generierte `CustomerUpdateDto`; weicht der generierte Typ ab, gilt der Typ.

- [ ] **Step 2: Die Seite**

```tsx
import { withEmporixSession } from "@viu/emporix-sdk-next/session";
import { pickText } from "@viu/emporix-examples-shared";
import { EMPORIX } from "../../emporix";
import { requireCustomer } from "../../lib/require-customer";
import { ActionForm } from "../../components/action-form";
import { changePassword, updateProfile } from "../../actions/account";

export default async function ProfilePage(): Promise<React.JSX.Element> {
  await requireCustomer("/account/profile");
  const customer = await withEmporixSession((client, ctx) => client.customers.me(ctx), EMPORIX);
  const c = customer as {
    firstName?: unknown;
    lastName?: unknown;
    email?: unknown;
    contactEmail?: unknown;
    contactPhone?: unknown;
  };

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <p className="eyebrow"><a href="/account" className="u-underline">← Account</a></p>
      <h1 className="serif">Profile</h1>
      <p className="muted">{pickText(c.email, "")}</p>

      <ActionForm action={updateProfile} submit="Save">
        <label className="field__label" htmlFor="firstName">First name</label>
        <input id="firstName" className="input" name="firstName" defaultValue={pickText(c.firstName, "")} />
        <label className="field__label" htmlFor="lastName">Last name</label>
        <input id="lastName" className="input" name="lastName" defaultValue={pickText(c.lastName, "")} />
        <label className="field__label" htmlFor="contactEmail">Contact email</label>
        <input id="contactEmail" className="input" name="contactEmail" type="email" defaultValue={pickText(c.contactEmail, "")} />
        <label className="field__label" htmlFor="contactPhone">Phone</label>
        <input id="contactPhone" className="input" name="contactPhone" type="tel" defaultValue={pickText(c.contactPhone, "")} />
      </ActionForm>

      <h2 className="serif" style={{ marginTop: "var(--s-6)" }}>Password</h2>
      <ActionForm action={changePassword} submit="Change">
        <label className="field__label" htmlFor="currentPassword">Current password</label>
        <input id="currentPassword" className="input" name="currentPassword" type="password" autoComplete="current-password" />
        <label className="field__label" htmlFor="newPassword">New password</label>
        <input id="newPassword" className="input" name="newPassword" type="password" autoComplete="new-password" />
      </ActionForm>
    </main>
  );
}
```

- [ ] **Step 3: Live-Beleg**

Namen ändern, speichern, neu laden — der neue Name steht im Formular **und** in
`/account`. Ein leeres Namensfeld zeigt «First and last name are required» ohne
Emporix-Request. Beim Passwort ein zu kurzes Neues zeigt die Längenmeldung; ein
falsches Aktuelles zeigt die Emporix-Meldung.

Das Passwort-Ändern nicht mit dem Testkonto durchspielen, wenn danach andere
Tasks damit anmelden müssen — sonst ist die `.env.local` veraltet.

- [ ] **Step 4: Commit**

```bash
git add examples/next-server-first
git commit -m "feat(examples): add a profile page to the next demo"
```

---

## Task 4.3: `/account/addresses` — CRUD über Server Actions

**Files:**
- Create: `examples/next-server-first/app/account/addresses/page.tsx`
- Modify: `examples/next-server-first/app/actions/account.ts`

**Interfaces:**
- Produces: `addAddress`, `updateAddress`, `deleteAddress` aus `app/actions/account.ts`.

- [ ] **Step 1: Die drei Actions**

Die sieben Feldnamen sind aus
`examples/storefront-demo/src/account/AddressForm.tsx` gelesen — dort läuft der
Aufruf gegen den echten Tenant, das ist die belastbare Quelle.

```ts
const ADDRESS_FIELDS = [
  "contactName",
  "contactPhone",
  "street",
  "streetNumber",
  "zipCode",
  "city",
  "country",
] as const;

function readAddress(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of ADDRESS_FIELDS) out[f] = String(form.get(f) ?? "").trim();
  return out;
}

function missing(a: Record<string, string>): string | null {
  // Emporix antwortet auf ein fehlendes Pflichtfeld mit einem 400, dessen Body
  // das Feld nennt. Hier vorher zu prüfen erspart den Umlauf und nennt es klarer.
  for (const f of ["contactName", "street", "zipCode", "city", "country"]) {
    if (a[f] === "") return `${f} is required`;
  }
  return null;
}

export async function addAddress(_state: ActionState, form: FormData): Promise<ActionState> {
  const address = readAddress(form);
  const problem = missing(address);
  if (problem !== null) return { error: problem };
  try {
    await withEmporixSessionMutable(
      (client, ctx) => client.customers.addresses.add(address as never, ctx),
      EMPORIX,
    );
  } catch (e) {
    return { error: describeError(e) };
  }
  revalidatePath("/account/addresses");
  return { error: null };
}

export async function updateAddress(_state: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("id"));
  const address = readAddress(form);
  const problem = missing(address);
  if (problem !== null) return { error: problem };
  try {
    await withEmporixSessionMutable(
      (client, ctx) => client.customers.addresses.update(id, address as never, ctx),
      EMPORIX,
    );
  } catch (e) {
    return { error: describeError(e) };
  }
  revalidatePath("/account/addresses");
  return { error: null };
}

export async function deleteAddress(_state: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("id"));
  try {
    await withEmporixSessionMutable(
      (client, ctx) => client.customers.addresses.remove(id, ctx),
      EMPORIX,
    );
  } catch (e) {
    return { error: describeError(e) };
  }
  revalidatePath("/account/addresses");
  return { error: null };
}
```

**Zum `as never`:** erst ohne den Cast typechecken. Beim Checkout hatte ich
denselben Cast aus storefront-demo übernommen und dann gemessen, dass er nicht
gebraucht wird. Bleibt der Typecheck rot, den Cast durch die generierte
Eingabeform ersetzen, nicht durch `never` — und wenn nur `never` geht, mit
einer Zeile begründen, warum.

- [ ] **Step 2: Die Seite**

```tsx
import { withEmporixSession } from "@viu/emporix-sdk-next/session";
import { EMPORIX } from "../../emporix";
import { requireCustomer } from "../../lib/require-customer";
import { ActionForm } from "../../components/action-form";
import { addAddress, deleteAddress, updateAddress } from "../../actions/account";

const FIELDS = [
  { name: "contactName", label: "Contact name" },
  { name: "contactPhone", label: "Phone" },
  { name: "street", label: "Street" },
  { name: "streetNumber", label: "No." },
  { name: "zipCode", label: "Postcode" },
  { name: "city", label: "City" },
  { name: "country", label: "Country (ISO-2)" },
] as const;

export default async function AddressesPage(): Promise<React.JSX.Element> {
  await requireCustomer("/account/addresses");
  const addresses = await withEmporixSession(
    (client, ctx) => client.customers.addresses.list(ctx),
    EMPORIX,
  );

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <p className="eyebrow"><a href="/account" className="u-underline">← Account</a></p>
      <h1 className="serif">Addresses</h1>

      <ul style={{ listStyle: "none", padding: 0 }}>
        {addresses.map((a) => {
          const r = a as Record<string, string | undefined>;
          const id = r.id ?? "";
          return (
            <li key={id} className="surface" style={{ marginBottom: "var(--s-4)" }}>
              <ActionForm action={updateAddress} submit="Save">
                <input type="hidden" name="id" value={id} />
                {FIELDS.map((f) => (
                  <span key={f.name}>
                    <label className="field__label" htmlFor={`${id}-${f.name}`}>{f.label}</label>
                    <input id={`${id}-${f.name}`} className="input" name={f.name} defaultValue={r[f.name] ?? ""} />
                  </span>
                ))}
              </ActionForm>
              <ActionForm action={deleteAddress} submit="Delete">
                <input type="hidden" name="id" value={id} />
              </ActionForm>
            </li>
          );
        })}
      </ul>

      <h2 className="serif">New address</h2>
      <ActionForm action={addAddress} submit="Add">
        {FIELDS.map((f) => (
          <span key={f.name}>
            <label className="field__label" htmlFor={`new-${f.name}`}>{f.label}</label>
            <input id={`new-${f.name}`} className="input" name={f.name} />
          </span>
        ))}
      </ActionForm>
    </main>
  );
}
```

- [ ] **Step 3: Live-Beleg**

Adresse anlegen (CH, gültige PLZ), Seite neu laden — sie steht in der Liste.
Stadt ändern, speichern, neu laden — geänderter Wert. Löschen, neu laden — weg.
Ein leeres Pflichtfeld zeigt «… is required» ohne Emporix-Request.

Danach `/checkout` öffnen: die gespeicherte Adresse muss dort vorbelegt sein —
das prüft, dass diese Seite die Adresse in der Form schreibt, die der Checkout
liest.

- [ ] **Step 4: Commit**

```bash
git add examples/next-server-first
git commit -m "feat(examples): add address crud to the next demo"
```

---

## Task 4.4: `/account/orders` und `/account/orders/[id]`

**Files:**
- Create: `examples/next-server-first/app/account/orders/page.tsx`, `app/account/orders/[id]/page.tsx`
- Modify: `examples/next-server-first/app/actions/account.ts`

**Interfaces:**
- Consumes: `orderVM`, `orderItems`, `money` aus `@viu/emporix-examples-shared`; `setCart` (Task 1.2).
- Produces: `cancelOrder`, `reorder` aus `app/actions/account.ts`.

- [ ] **Step 1: Die Listenseite**

```tsx
import { withEmporixSession } from "@viu/emporix-sdk-next/session";
import { money, orderVM } from "@viu/emporix-examples-shared";
import { EMPORIX } from "../../emporix";
import { requireCustomer } from "../../lib/require-customer";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}): Promise<React.JSX.Element> {
  await requireCustomer("/account/orders");
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const result = await withEmporixSession(
    (client, ctx) => client.orders.listMine(ctx, { pageNumber: page, pageSize: 10 }),
    EMPORIX,
  );

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <p className="eyebrow"><a href="/account" className="u-underline">← Account</a></p>
      <h1 className="serif">Orders</h1>
      {result.items.length === 0 ? (
        <p className="muted">No orders yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {result.items.map((o) => {
            const vm = orderVM(o);
            return (
              <li key={vm.id} className="surface" style={{ marginBottom: "var(--s-3)" }}>
                <a href={`/account/orders/${encodeURIComponent(vm.id)}`} className="u-underline serif">
                  {vm.number}
                </a>
                <span className="tag">{vm.status}</span>
                <span className="muted">{vm.itemCount} item(s)</span>
                <span className="price">{vm.total ? money(vm.total.amount, vm.total.currency) : "—"}</span>
              </li>
            );
          })}
        </ul>
      )}
      <nav className="cluster" style={{ gap: "var(--s-4)" }}>
        {page > 1 ? <a href={`/account/orders?page=${page - 1}`} className="btn btn--outline">← Previous</a> : null}
        <span className="muted">Page {page}</span>
        {result.hasNextPage ? <a href={`/account/orders?page=${page + 1}`} className="btn btn--outline">Next →</a> : null}
      </nav>
    </main>
  );
}
```

- [ ] **Step 2: Die zwei Actions**

`orders.cancel` nimmt einen optionalen `saasToken`. Im server-first-Modus liegt
der in der Session und darf den Browser nie erreichen — das ist derselbe
Mechanismus wie beim Checkout und der Grund, warum diese Action serverseitig
sein **muss**.

```ts
export async function cancelOrder(_state: ActionState, form: FormData): Promise<ActionState> {
  const orderId = String(form.get("orderId"));
  try {
    await withEmporixSessionMutable(async (client, ctx, jar) => {
      const saasToken = jar.get(STORAGE_KEYS.saasToken);
      await client.orders.cancel(
        orderId,
        ctx,
        saasToken !== null ? { saasToken } : {},
      );
    }, EMPORIX);
  } catch (e) {
    return { error: describeError(e) };
  }
  revalidatePath("/account/orders");
  revalidatePath(`/account/orders/${orderId}`);
  return { error: null };
}

export async function reorder(_state: ActionState, form: FormData): Promise<ActionState> {
  const orderId = String(form.get("orderId"));
  try {
    await withEmporixSessionMutable(async (client, ctx, jar) => {
      const order = await client.orders.get(orderId, ctx);
      const items = orderItems(order).map((i) => ({
        itemYrn: productYrn(client.tenant, i.productId),
        quantity: i.quantity,
      }));
      if (items.length === 0) throw new Error("This order has no items to reorder");

      let cartId = jar.get(STORAGE_KEYS.cartId);
      if (cartId === null) {
        // getCurrent({ create: true }), nicht create: ein Kunde darf nur einen
        // offenen Warenkorb haben, und ein blindes create antwortet mit 409.
        const cart = await client.carts.getCurrent(ctx, { siteCode: SITE.siteCode, create: true });
        cartId = cart?.id ?? null;
        if (cartId === null) throw new Error("Emporix returned no cart");
        setCart(jar, cart);
      }
      await client.carts.addItemsBatch(cartId, { items } as never, ctx);
      setCart(jar, await client.carts.get(cartId, ctx));
    }, EMPORIX);
  } catch (e) {
    return { error: describeError(e) };
  }
  revalidatePath("/cart");
  revalidatePath("/");
  return { error: null };
}
```

`orderItems`, `productYrn` und `SITE` importieren. Das `as never` bei
`addItemsBatch` stammt aus `use-reorder.ts` — erst ohne den Cast typechecken und
ihn nur behalten, wenn es ohne rot bleibt. Emporix verlangt auf internen
Positionen einen `priceId`; schlägt der Batch mit dieser Meldung fehl, ist der
Preis pro Position wie in `addToCart` über `matchByContext` aufzulösen. Das dann
so umsetzen und im README festhalten, dass der Reorder Preise neu auflöst statt
die der Bestellung zu übernehmen.

- [ ] **Step 3: Die Detailseite**

```tsx
import { withEmporixSession } from "@viu/emporix-sdk-next/session";
import { money, orderItems, orderVM } from "@viu/emporix-examples-shared";
import { EMPORIX } from "../../../emporix";
import { requireCustomer } from "../../../lib/require-customer";
import { ActionForm } from "../../../components/action-form";
import { cancelOrder, reorder } from "../../../actions/account";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  await requireCustomer(`/account/orders/${id}`);
  const order = await withEmporixSession((client, ctx) => client.orders.get(id, ctx), EMPORIX);
  const vm = orderVM(order);
  const items = orderItems(order);

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <p className="eyebrow"><a href="/account/orders" className="u-underline">← Orders</a></p>
      <h1 className="serif">{vm.number}</h1>
      <p><span className="tag">{vm.status}</span> {vm.createdAt ?? ""}</p>

      <ul style={{ listStyle: "none", padding: 0 }}>
        {items.map((i) => (
          <li key={i.id} className="cart__line">
            <span className="serif">{i.name}</span>
            <span className="muted">× {i.quantity}</span>
            <span className="price">{i.lineTotal ? money(i.lineTotal.amount, i.lineTotal.currency) : ""}</span>
          </li>
        ))}
      </ul>
      <p className="price">Total {vm.total ? money(vm.total.amount, vm.total.currency) : "—"}</p>

      <div className="cluster" style={{ gap: "var(--s-4)" }}>
        <ActionForm action={reorder} submit="Reorder">
          <input type="hidden" name="orderId" value={vm.id} />
        </ActionForm>
        <ActionForm action={cancelOrder} submit="Cancel order">
          <input type="hidden" name="orderId" value={vm.id} />
        </ActionForm>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Live-Beleg**

Angemeldet `/account/orders` öffnen — die Bestellungen aus den früheren
Checkout-Tests (EON1225, EON1226) stehen da mit Nummer, Status und Summe. Ein
Detail öffnen: Positionen mit **Namen**, nicht mit Ids. «Reorder» erhöht den
Badge und `/cart` zeigt die Positionen. «Cancel order» auf einer Bestellung im
Status `IN_CHECKOUT` ändert den Status; auf einer abgeschlossenen zeigt es die
Emporix-Meldung im Formular statt einer Fehlerseite.

Der Namens-Punkt ist nicht Kosmetik: `orderItems` liest beide Bestellformen
(Liste mit `items`, GET mit `entries`), und ohne die geteilte Funktion wäre die
Detailseite leer.

- [ ] **Step 5: README-Tabelle nachziehen**

In `examples/next-server-first/README.md` die Tabelle «What each page proves»
um die neuen Routen ergänzen und einen datierten Verifikationsabschnitt für
diese Arbeit anlegen — nach dem Muster der bestehenden Tabellen, mit den
tatsächlich beobachteten Werten, nicht mit erwarteten.

Ebenso die vier Nicht-Ziele aus der Spec eintragen:

```markdown
## Was diese Demo bewusst NICHT hat

- `/account/returns`, `/account/rewards`, `/account/lists` — dasselbe
  CRUD-über-Server-Action-Muster wie `addresses`, ein viertes Mal. Es lehrt
  nichts Neues und müsste bei jeder SDK-Änderung mitgezogen werden.
- `/reset-password` — braucht einen echten E-Mail-Umlauf. Was nicht
  verifizierbar ist, wird hier nicht behauptet.
- B2B — hat `storefront-demo` auch nicht.
- Optimistische Updates — es gibt keinen Client-State, der optimistisch sein
  könnte. Der dokumentierte Preis des Modus, keine offene Aufgabe.
```

- [ ] **Step 6: Commit**

```bash
git add examples/next-server-first
git commit -m "feat(examples): add order history to the next demo"
```

---

## Task 5.1: Webhook-Route und `revalidateTag`

**Files:**
- Create: `examples/next-server-first/app/api/emporix/webhook/route.ts`
- Modify: `examples/next-server-first/README.md`

**Interfaces:**
- Consumes: den Webhook-Export aus `@viu/emporix-sdk-next/webhook`.

- [ ] **Step 1: Die Route**

`createEmporixWebhookRoute(opts)` gibt einen `(req: Request) => Promise<Response>`
zurück, der direkt als `POST` exportiert wird — kein Destructuring. Optionen:
`secret` (Pflicht), `onEvent?`, `maxAgeSeconds?`, `canonicalize?`, `profile?`
(Standard `{ expire: 0 }`).

```ts
import { createEmporixWebhookRoute } from "@viu/emporix-sdk-next/webhook";

const secret = process.env.EMPORIX_WEBHOOK_SECRET;
// Werfen statt still 401 zu liefern: eine Route, die jede Lieferung ablehnt,
// weil eine Variable fehlt, ist die teuerste Art, einen Konfigurationsfehler zu
// verstecken. Das ist das Muster, das dieses Example schon für den Tenant nutzt.
if (secret === undefined || secret === "") {
  throw new Error("EMPORIX_WEBHOOK_SECRET is not set — see the README.");
}

/**
 * Der Auslöser, der bisher fehlte.
 *
 * Der getaggte Client (`getEmporixClient()`) versieht Katalog-Antworten mit
 * Cache-Tags, und diese Route ruft `revalidateTag` darauf (webhook.ts:163).
 * Ohne diese Datei hatte die Hälfte keinen Absender: kein Example mountete sie.
 *
 * Für Warenkorb, Bestellungen und Kundendaten gibt es das NICHT und kann es
 * nicht geben — `emporixTagsForUrl` gibt dort absichtlich `[]` zurück. Das
 * `revalidatePath` in den Cart-Actions ist deshalb korrekt und nicht das
 * Grobwerkzeug; es ist das einzige Werkzeug.
 */
export const POST = createEmporixWebhookRoute({
  secret,
  // Fünf Minuten Replay-Fenster. Ohne die Option wird das Alter der Lieferung
  // gar nicht geprüft, und eine abgefangene Lieferung bleibt beliebig lange
  // gültig.
  maxAgeSeconds: 300,
});
```

- [ ] **Step 2: README-Abschnitt mit dem Secret**

```markdown
## Webhook: `revalidateTag` schliesst den Kreis

```
EMPORIX_WEBHOOK_SECRET=<das in Emporix konfigurierte Secret>
```

Katalogdaten werden vom getaggten Client zwischengespeichert und leben, bis
etwas sie für ungültig erklärt. Diese Route ist das Etwas. Ohne sie hilft nur
Warten.

Für Warenkorb, Bestellungen und Kundendaten gibt es keine Tags — absichtlich,
sie sind pro Besucher veränderlich oder geheim. Dort ist `revalidatePath`
richtig.
```

`.env.example` ergänzt der Mensch: `.env*` liegt ausserhalb der Schreibrechte.

- [ ] **Step 3: Live-Beleg**

Ein Produkt im Emporix-Backend umbenennen und die Katalogseite laden — sie zeigt
noch den alten Namen (das ist der Cache, kein Fehler). Dann den Webhook mit
gültiger Signatur feuern und neu laden: neuer Name, ohne Deploy und ohne
Wartezeit.

Danach mit **falscher** Signatur feuern: `401`, und ein danach geänderter Name
erscheint **nicht** — eine ungültige Signatur darf nichts invalidieren.

Die Signaturberechnung aus `packages/next/tests/webhook.test.ts` übernehmen; die
Tests dort bauen sie schon.

- [ ] **Step 4: Commit**

```bash
git add examples/next-server-first
git commit -m "feat(examples): mount the webhook route in the next demo"
```

---

## Abschluss

**Ausführungsreihenfolge — sieben PRs, nicht sechs.** Die Spec zählt sechs; beim
Planen kam heraus, dass der Umschalter aus Muster 1 den Kontext jeder Leserstelle
umstellt und deshalb eine eigene PR am Ende braucht:

```
0  →  1.1 → 1.2  →  2.1 → 2.2 → 2.3  →  3.1 → 3.2  →  4.1 → 4.2 → 4.3 → 4.4  →  5.1  →  6.1
```

`6.1` steht im Dokument oberhalb von `2.1`, weil es inhaltlich zur Shell gehört —
ausgeführt wird es **zuletzt**.

Nach jeder PR-Gruppe (0 · 1.1–1.2 · 2.1–2.3 · 3.1–3.2 · 4.1–4.4 · 5.1 · 6.1):

```bash
pnpm -r build && pnpm -r test && pnpm typecheck && pnpm lint
```

Erwartet: `pnpm -r test` bleibt bei 1'439 Tests plus **5** aus Task 0 (nicht 3 —
beim Umsetzen kamen zwei dazu, für den saasToken und für die Ein-Record-Zusage)
plus 4 aus Task 4.1 = **1'448**. Nach Task 0 gemessen: **1'444**. Typecheck deckt
nach Task 1.1 elf Projekte statt zehn.

Dann `superpowers:finishing-a-development-branch` für die PR. Changesets nur für
Task 0 — `@viu/emporix-examples-*` ist in `.changeset/config.json` unter
`ignore` und wird nie versioniert.
