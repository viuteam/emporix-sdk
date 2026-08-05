# Katalog-ISR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die vier Katalogrouten von `examples/next-server-first` statisch rendern und per ISR cachen, damit bei 1'000 CCU rund 60 % der Seitenaufrufe den Node-Prozess gar nicht mehr erreichen.

**Architecture:** Zwei Dinge machen heute jede Route dynamisch, und beide müssen weg: die Sprache kommt aus einem Cookie (`app/lib/site-context.ts:53`) und der Header liest die Session (`app/components/header.tsx:20-21`). Die Sprache wandert in ein `[lang]`-Routensegment, der Header wird eine Client-Komponente, die den personalisierten Teil über einen eigenen Route Handler nachlädt. Danach greifen `export const revalidate` und `generateStaticParams`.

**Tech Stack:** Next 16.2.12 App Router (Node runtime), TypeScript, Vitest.

## Global Constraints

- **Kein `experimental.cacheComponents`.** In Next 16.2.12 ist `experimental.ppr` deprecated und in `cacheComponents` aufgegangen — weiterhin experimentell. Ein Referenz-Storefront, den andere kopieren, stellt seine Caching-Story nicht auf ein experimentelles Flag. Alles hier läuft auf stabilem Next.
- Kein Emporix-Token im Browser. Ein Fetch auf **eigene** Route Handler ist erlaubt und existiert bereits (`app/api/emporix/[...path]/route.ts`).
- Commitlint: Scope aus der Allowlist (`examples` passt), erstes Wort kleingeschrieben.
- Changeset nötig (der Gate läuft unkonditioniert), auch wenn nur `examples/**` geändert wird — die Example-Pakete sind zwar `ignore`d, der Gate prüft aber die Existenz eines Changesets.
- Verifikation ohne Lasttest: die Ausgabe von `next build` ist der Beweis. Sie markiert pro Route `○` (statisch), `●` (SSG) oder `ƒ` (dynamisch).

## Ausgangslage und Ziel

| Route | Heute | Nach diesem Plan |
|---|---|---|
| `/` | ƒ dynamisch | Redirect auf `/de` |
| `/[lang]` | — | ● ISR, `revalidate 3600` |
| `/[lang]/categories` | ƒ (`/categories`) | ● ISR |
| `/[lang]/category/[id]` | ƒ | ƒ→ISR on demand (`dynamicParams`) |
| `/[lang]/product/[id]` | ƒ | ƒ→ISR on demand |
| `/search`, `/cart`, `/checkout`, `/account/*`, `/login` | ƒ | ƒ — unverändert und richtig |

## File Structure

| Datei | Verantwortung |
|---|---|
| `app/[lang]/layout.tsx` | **neu.** Besitzt den `lang`-Parameter, `generateStaticParams`, validiert gegen `LANGUAGES`. |
| `app/[lang]/page.tsx`, `categories/page.tsx`, `category/[id]/page.tsx`, `product/[id]/page.tsx` | **verschoben.** Nehmen `lang` aus den Params statt aus dem Cookie. |
| `app/page.tsx` | **ersetzt.** Statischer Redirect auf die Standardsprache. |
| `app/components/header.tsx` | **Client-Komponente.** Kein Server-Cookie-Read mehr; leitet die Katalog-Links aus `usePathname()` ab. |
| `app/components/session-nav.tsx` | **neu, Client.** Holt `{ cartCount, loggedIn }` von der eigenen API. |
| `app/api/session/nav/route.ts` | **neu.** Liest die Session serverseitig, gibt zwei Felder zurück, `no-store`. |
| `app/lib/site-context.ts` | `siteContext(lang?)` — Katalogrouten geben die URL-Sprache mit, Session-Routen lesen weiter das Cookie. |
| `app/components/product-grid.tsx` | bekommt `lang` als Prop für die Produktlinks. |

---

### Task 1: Sprache aus der URL statt aus dem Cookie

**Files:**
- Create: `app/[lang]/layout.tsx`
- Modify: `app/lib/site-context.ts`
- Test: `examples/next-server-first/tests/lang.test.ts`

**Interfaces:**
- Produces: `LANGUAGES: readonly ["en","de"]` (existiert), `DEFAULT_LANGUAGE = "de"`, `isLanguage(x: string): x is Language`, `siteContext(lang?: string)`.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_LANGUAGE, isLanguage } from "../app/lib/languages";

describe("isLanguage", () => {
  it("accepts what the tenant offers", () => {
    expect(isLanguage("de")).toBe(true);
    expect(isLanguage("en")).toBe(true);
  });
  it("rejects anything else, including case variants", () => {
    // A static param is attacker-controlled: /xx/category/… must 404, not render.
    expect(isLanguage("fr")).toBe(false);
    expect(isLanguage("DE")).toBe(false);
    expect(isLanguage("")).toBe(false);
  });
  it("defaults to the tenant's default language", () => {
    expect(DEFAULT_LANGUAGE).toBe("de");
  });
});
```

- [ ] **Step 2: Fehlschlag bestätigen** — `npx vitest run tests/lang.test.ts`, Modul fehlt.

- [ ] **Step 3: `app/lib/languages.ts` anlegen**

Reine Konstanten ohne Server-Imports, damit vitest sie laden kann (dieselbe Trennung wie `category-walk.ts`).

- [ ] **Step 4: `siteContext(lang?)`** — Signatur erweitern, Cookie-Read nur noch als Fallback.

- [ ] **Step 5: Tests grün, commit.**

---

### Task 2: Header ohne Server-Session

Der Blocker für jede statische Route. Nach diesem Task liest im Render-Pfad einer Katalogseite nichts mehr Cookies.

**Files:**
- Create: `app/api/session/nav/route.ts`, `app/components/session-nav.tsx`
- Modify: `app/components/header.tsx`, `app/components/language-switcher.tsx`

- [ ] **Step 1: Route Handler** — liest `emporixSessionHandle({readOnly:true})`, gibt `{ cartCount, loggedIn }`, Header `Cache-Control: no-store`.
- [ ] **Step 2: `SessionNav`** als Client-Komponente mit `useEffect`-Fetch und einem Fallback ohne Layout-Shift.
- [ ] **Step 3: `Header`** auf `"use client"`, Katalog-Links aus `usePathname()`.
- [ ] **Step 4: `LanguageSwitcher`** von Server Action auf Links umstellen — schreibt weiter das Cookie über den Handler, damit Session-Routen der URL folgen.
- [ ] **Step 5: `pnpm dev`, Header prüfen, commit.**

---

### Task 3: Katalogrouten verschieben und ISR aktivieren

**Files:**
- Move: vier Seiten unter `app/[lang]/`
- Modify: alle internen Katalog-Links (Inventar unten), `app/page.tsx` als Redirect

Betroffene Links: `page.tsx:48,53`, `categories/page.tsx:32`, `category/[id]/page.tsx:74,80,110`, `product/[id]/page.tsx:72,111`, `components/product-grid.tsx:32`, `components/header.tsx:30,52`, `cart/page.tsx:23`, `checkout/page.tsx:14`, `checkout/done/page.tsx:20`.

- [ ] **Step 1: Seiten verschieben, `params.lang` durchreichen.**
- [ ] **Step 2: `revalidate` und `generateStaticParams` setzen.**
- [ ] **Step 3: Links prefixen.**
- [ ] **Step 4: `next build` — Beweis, dass die Routen `●`/`○` sind.**
- [ ] **Step 5: Commit.**

---

### Task 4: Doku, Changeset, PR

- [ ] README des Beispiels: warum `[lang]` in der URL steht und was das mit Caching zu tun hat.
- [ ] Changeset (`examples`-Pakete sind ignored, der Gate braucht trotzdem eine Datei).
- [ ] PR gegen `main`, getrennt vom Performance-Plan-PR.

## Was dieser Plan nicht tut

Die Session-Routen (`/cart`, `/checkout`, `/account/*`) bleiben dynamisch und cookie-basiert. Das ist kein Rest, sondern richtig: sie sind pro Besucher, dürfen nie geteilt werden, und ein `[lang]`-Präfix brächte ihnen nichts.

Die daraus folgende Naht — Katalog liest die Sprache aus der URL, Session aus dem Cookie — hält der Sprachumschalter zusammen, indem er beides schreibt. Das ist die einzige Stelle, an der die zwei Quellen auseinanderlaufen können, und sie ist genau eine Datei gross.
