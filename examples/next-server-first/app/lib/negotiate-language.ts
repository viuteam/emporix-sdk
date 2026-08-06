/**
 * Which of the languages we serve this visitor would rather have.
 *
 * Used for exactly one decision: where `/` sends somebody. Every other URL in this app
 * carries its language in the path, which is the point of the whole layout.
 *
 * `served` and `fallback` are arguments rather than imports so this stays a pure
 * function of its inputs — the test needs no fixtures and the module needs no knowledge
 * of the tenant.
 *
 * Deliberately not a full RFC 4647 implementation: no extended language ranges, no `*`
 * weighting, no script or variant subtags. It compares primary subtags, which is what a
 * two-language storefront needs, and it never throws on a malformed header because that
 * header comes off the wire.
 */
export function negotiateLanguage(
  header: string | null,
  served: readonly string[],
  fallback: string,
): string {
  if (header === null || header.trim() === "") return fallback;

  const ranked = header
    .split(",")
    .map((part) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.toLowerCase().startsWith("q="));
      // `Number("notanumber")` is NaN, so `Number.isFinite` sends a broken q back to the
      // default weight rather than letting it poison the sort.
      const weight = q === undefined ? 1 : Number(q.slice(2));
      return {
        // Primary subtag only: `de-CH` and `DE-ch` both mean `de` here.
        primary: (tag.split("-")[0] ?? "").trim().toLowerCase(),
        weight: Number.isFinite(weight) ? weight : 1,
      };
    })
    .filter((c) => c.primary !== "" && c.primary !== "*" && c.weight > 0)
    // Descending, and stable — so equal weights keep the client's own order.
    .sort((a, b) => b.weight - a.weight);

  for (const candidate of ranked) {
    const hit = served.find((s) => s.toLowerCase() === candidate.primary);
    if (hit !== undefined) return hit;
  }
  return fallback;
}
