/**
 * Is this request a real top-level navigation by the visitor?
 *
 * Needed because a proxy writes visitor state, and a **speculative** request must
 * not. The case that surfaced it: `emporixSiteProxy` writes `emporix.language`
 * from the path, and a `<Link>` prefetch of a route in the other language switched
 * the visitor's language — no click, just the link entering the viewport.
 * Reproduced on 2026-08-05 with a real Chrome prefetch against `next start`.
 *
 * **Why this does not check for "is a prefetch".** That would be the direct signal
 * and it is not available in Next middleware. Measured on 2026-08-05 (Next
 * 16.2.12) — the browser sends these, middleware sees nothing:
 *
 * | sent by the browser                 | seen in middleware |
 * | ----------------------------------- | ------------------ |
 * | `next-router-prefetch: 1`           | `null`             |
 * | `rsc: 1`                            | `null`             |
 * | `next-router-segment-prefetch: …`   | `null`             |
 * | `?_rsc=…` in the URL                | not visible        |
 *
 * Next strips its own router signals before middleware runs. A prefetch is
 * therefore indistinguishable there from a genuine client-side navigation — both
 * are `sec-fetch-mode: cors`.
 *
 * What is left is the opposite direction: a real document navigation carries
 * `sec-fetch-mode: navigate`, anything fetch-based carries `cors`. That header
 * comes from the browser rather than from Next, which is why it arrives.
 *
 * It is enough, because writing from the path is only needed on **first contact**,
 * and first contact is always a document navigation. Any later intentional change
 * goes through the application's own language switcher, which writes its cookie
 * itself.
 *
 * **A missing header counts as `true`.** Old clients, `curl` and bots send no
 * `sec-fetch-mode`; treating them as a navigation keeps their behaviour unchanged
 * instead of silently denying them state. A prefetch always comes from a browser
 * that sets the header, so the assumption costs nothing on the case that matters.
 *
 * The parameter type is structural rather than `NextRequest` so this file stays
 * testable without `next/server`.
 */
export function isTopLevelNavigation(request: {
  headers: { get(name: string): string | null };
}): boolean {
  const mode = request.headers.get("sec-fetch-mode");
  return mode === null || mode === "" || mode === "navigate";
}
