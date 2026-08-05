/**
 * Ist dieser Request eine echte Top-Level-Navigation des Besuchers?
 *
 * Gebraucht, weil ein Proxy Besucherzustand schreibt und ein **spekulativer**
 * Request das nicht darf. Der Fall, der es aufgedeckt hat: `emporixSiteProxy`
 * schreibt `emporix.language` aus dem Pfad, und ein `<Link>`-Prefetch auf eine
 * Route in der anderen Sprache stellte damit die Sprache des Besuchers um —
 * ohne Klick, sobald der Link ins Blickfeld geriet. Am 2026-08-05 mit einem
 * echten Chrome-Prefetch gegen `next start` reproduziert.
 *
 * **Warum nicht auf «ist ein Prefetch» geprueft wird.** Das waere das direktere
 * Signal, ist in einer Next-Middleware aber nicht verfuegbar. Gemessen am
 * 2026-08-05 (Next 16.2.12) — der Browser sendet, die Middleware sieht nichts:
 *
 * | gesendet                            | in der Middleware |
 * | ----------------------------------- | ----------------- |
 * | `next-router-prefetch: 1`           | `null`            |
 * | `rsc: 1`                            | `null`            |
 * | `next-router-segment-prefetch: …`   | `null`            |
 * | `?_rsc=…` in der URL                | nicht sichtbar    |
 *
 * Next entfernt seine eigenen Router-Signale, bevor die Middleware laeuft. Ein
 * Prefetch ist dort nicht von einer echten clientseitigen Navigation zu
 * unterscheiden — beide sind `sec-fetch-mode: cors`.
 *
 * Was bleibt, ist die Gegenrichtung: eine echte Dokument-Navigation traegt
 * `sec-fetch-mode: navigate`, alles fetch-basierte `cors`. Dieser Header kommt
 * vom Browser, nicht von Next, und kommt deshalb an.
 *
 * Das reicht, weil ein Schreibvorgang aus dem Pfad nur beim **Erstkontakt**
 * gebraucht wird, und ein Erstkontakt ist immer eine Dokument-Navigation. Eine
 * absichtliche spaetere Aenderung laeuft ueber den Umschalter der Anwendung, der
 * sein Cookie selbst schreibt.
 *
 * **Fehlt der Header, gilt `true`.** Alte Clients, `curl` und Bots senden kein
 * `sec-fetch-mode`; sie als Navigation zu behandeln haelt das Verhalten fuer sie
 * unveraendert, statt ihnen still den Zustand zu verweigern. Ein Prefetch kommt
 * immer aus einem Browser, der den Header setzt — die Annahme kostet also nichts
 * am Fall, um den es geht.
 *
 * Der Parametertyp ist strukturell und nicht `NextRequest`, damit die Datei ohne
 * `next/server` testbar bleibt.
 */
export function isTopLevelNavigation(request: {
  headers: { get(name: string): string | null };
}): boolean {
  const mode = request.headers.get("sec-fetch-mode");
  return mode === null || mode === "" || mode === "navigate";
}
