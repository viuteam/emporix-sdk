import { isLanguage, type Language } from "./languages";

/**
 * Die Sprache, die ein Pfad ansagt — oder `null`, wenn er keine ansagt.
 *
 * Steht als eigene Datei da, weil `proxy.ts` sie braucht und Tests sie laden
 * muessen: derselbe Schnitt wie bei `swap-language.ts` und `category-index.ts`.
 * Ein Proxy laeuft in einer Umgebung ohne `cookies()`, und vitest kann nichts
 * laden, das `@viu/emporix-sdk-next/session` hereinzieht.
 *
 * `null` und nicht `DEFAULT_LANGUAGE`: der Unterschied zwischen «dieser Pfad sagt
 * `de`» und «dieser Pfad sagt nichts» ist der ganze Zweck der Funktion.
 * `emporixSiteProxy` laesst ein fehlendes Feld in Ruhe, es gibt kein Loeschen —
 * `/cart` darf die Wahl also nicht ueberschreiben, nur `/de/cart` duerfte das.
 */
export function pathLanguage(pathname: string): Language | null {
  const segment = pathname.split("/")[1] ?? "";
  return isLanguage(segment) ? segment : null;
}
