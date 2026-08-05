import { describe, expect, it } from "vitest";
import { isTopLevelNavigation } from "../src/navigation";

/** Ein minimaler Request-Stub: das Praedikat liest nur `headers.get`. */
function req(headers: Record<string, string>): { headers: { get(n: string): string | null } } {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { headers: { get: (n) => lower.get(n.toLowerCase()) ?? null } };
}

describe("isTopLevelNavigation", () => {
  it("erkennt eine Dokument-Navigation", () => {
    // Gemessen an einem echten Seitenaufruf in Chrome: navigate + document.
    expect(isTopLevelNavigation(req({ "Sec-Fetch-Mode": "navigate" }))).toBe(true);
  });

  it("erkennt einen fetch-basierten Request als KEINE Navigation", () => {
    // Prefetch und clientseitige Navigation sind beide `cors` — die Middleware
    // kann sie nicht trennen, und muss es fuer diesen Zweck auch nicht.
    expect(isTopLevelNavigation(req({ "Sec-Fetch-Mode": "cors" }))).toBe(false);
  });

  it("behandelt same-origin fetch als keine Navigation", () => {
    expect(isTopLevelNavigation(req({ "Sec-Fetch-Mode": "same-origin" }))).toBe(false);
  });

  it("behandelt einen fehlenden Header als Navigation", () => {
    // Alte Clients, curl und Bots senden keinen — ihnen still den Zustand zu
    // verweigern waere die schlechtere Wahl. Ein Prefetch kommt immer aus einem
    // Browser, der den Header setzt.
    expect(isTopLevelNavigation(req({}))).toBe(true);
  });

  it("behandelt einen leeren Header als Navigation", () => {
    expect(isTopLevelNavigation(req({ "Sec-Fetch-Mode": "" }))).toBe(true);
  });

  it("prueft den Wert exakt und nicht per Teilstring", () => {
    // `no-cors` enthaelt kein «navigate», darf aber auch nicht versehentlich
    // durchfallen, wenn jemand spaeter auf `includes` umstellt.
    expect(isTopLevelNavigation(req({ "Sec-Fetch-Mode": "no-cors" }))).toBe(false);
    expect(isTopLevelNavigation(req({ "Sec-Fetch-Mode": "navigate-ish" }))).toBe(false);
  });
});
