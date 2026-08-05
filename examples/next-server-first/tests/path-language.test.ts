import { describe, expect, it } from "vitest";
import { pathLanguage } from "../app/lib/path-language";

/**
 * Der Regressionstest zum Sprachbruch.
 *
 * Gemessen am 2026-08-05: die Produktseite `/de/product/…` zeigte «Just-in-Time
 * Zugriff (JIT)», derselbe Artikel im Warenkorb «Just-in-Time Access (JIT)».
 * Ursache war nicht die Lage der Routen, sondern dass niemand das Sprachcookie
 * schrieb, solange der Besucher den Umschalter nicht anklickte. `proxy.ts` leitet
 * die Sprache jetzt aus dem Pfad ab — und diese Ableitung ist die Stelle, an der es
 * wieder brechen kann.
 */
describe("pathLanguage", () => {
  it("liest die Sprache aus dem ersten Segment", () => {
    expect(pathLanguage("/de")).toBe("de");
    expect(pathLanguage("/en")).toBe("en");
    expect(pathLanguage("/de/categories")).toBe("de");
    expect(pathLanguage("/en/product/abc/2")).toBe("en");
  });

  it("sagt null, wenn der Pfad keine Sprache ansagt", () => {
    // Der Unterschied, auf den es ankommt: eine Sitzungsroute darf die Wahl des
    // Besuchers nicht ueberschreiben, weil sie ueber Sprache nichts aussagt.
    expect(pathLanguage("/cart")).toBeNull();
    expect(pathLanguage("/checkout")).toBeNull();
    expect(pathLanguage("/account/orders")).toBeNull();
    expect(pathLanguage("/")).toBeNull();
    expect(pathLanguage("")).toBeNull();
  });

  it("nimmt nichts an, was der Tenant nicht anbietet", () => {
    // Der Wert landet in einem Cookie und von dort im `Accept-Language` jeder
    // Emporix-Anfrage der Sitzung. Ein Pfad ist angreifergesteuert.
    expect(pathLanguage("/fr/product/x")).toBeNull();
    expect(pathLanguage("/DE")).toBeNull();
    expect(pathLanguage("/de-CH")).toBeNull();
    expect(pathLanguage("/..%2f")).toBeNull();
  });

  it("verwechselt eine Sitzungsroute nicht mit einem Sprachpraefix", () => {
    // `/debug` beginnt nicht mit «de», auch wenn die zwei Buchstaben da stehen.
    expect(pathLanguage("/debug")).toBeNull();
    expect(pathLanguage("/design")).toBeNull();
  });
});
