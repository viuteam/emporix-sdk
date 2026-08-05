/**
 * The sheet and its title block — the signature element of this demo.
 *
 * A reference implementation is an annotated drawing, and a drawing carries a table in
 * the corner of the sheet saying what you are looking at. Here it says **how this route
 * was rendered**: static or per request, with which revalidation, and how many parts of
 * the page hydrate in the browser.
 *
 * That is the most interesting information this demo holds, and until now it appeared
 * nowhere — only on `/debug`, which is precisely not where you want to see it.
 *
 * **The values are hand-written, and that is a decision.** One could guess the render
 * mode at runtime, but every route there falsifies the answer: reading `cookies()` or
 * `headers()` to find out whether a route is static makes it dynamic. One line per page
 * repeating the truth from `next build` is more honest than a derivation that breaks its
 * own subject — and `next build` is the test for it: a `●` there against a `DYNAMIC`
 * here means one of the two is wrong.
 */

/** How Next built this route — the «Route» column of `next build`. */
export type RenderMode = "static" | "dynamic";

export interface SheetMeta {
  /** The route pattern, not the resolved URL. */
  route: string;
  render: RenderMode;
  /** Seconds, as in `export const revalidate`. Absent on dynamic routes. */
  revalidate?: number;
  /** Why this route renders per request. Only meaningful with `dynamic`. */
  because?: string;
  /**
   * The client islands of THIS page, as phrases rather than as a number.
   *
   * This started out as a list of names, and the title block computed `length + 2` from
   * it. On the cart the result was false: every mutation form is an `ActionForm` and
   * therefore its own island, so the number grows with the number of lines. A title
   * block that computes can compute wrongly — this one no longer counts, it names.
   */
  islands?: string[];
}

function seconds(s: number): string {
  if (s % 3600 === 0) return `${s / 3600}h`;
  if (s % 60 === 0) return `${s / 60}min`;
  return `${s}s`;
}

/** One row of the title block. */
function Row({
  k,
  children,
  tone,
}: {
  k: string;
  children: React.ReactNode;
  tone?: "static" | "dynamic";
}): React.JSX.Element {
  const cls =
    tone === undefined ? "tblock__val" : `tblock__val tblock__val--${tone}`;
  return (
    <div className="tblock__row">
      <div className="tblock__key">{k}</div>
      <div className={cls}>{children}</div>
    </div>
  );
}

/**
 * The title block on its own. It lives in the rail but works without one — `/debug`
 * uses it that way.
 */
export function TitleBlock({ meta }: { meta: SheetMeta }): React.JSX.Element {
  const islands = meta.islands ?? [];
  return (
    <div className="tblock">
      <Row k="Route">{meta.route}</Row>
      <Row k="Render" tone={meta.render}>
        {meta.render === "static" ? "STATIC · ISR" : "DYNAMIC"}
      </Row>
      {meta.revalidate !== undefined ? (
        <Row k="Revalid.">{seconds(meta.revalidate)}</Row>
      ) : null}
      {meta.because !== undefined ? <Row k="Reason">{meta.because}</Row> : null}
      <Row k="Islands">
        {/* The header sits in the root layout, so its two islands — language picker and
            session nav — hydrate on every page. They appear as «2 shell», because they
            do not belong to the page. */}
        {["2 shell", ...islands].join(" + ")}
      </Row>
      <Row k="Token">none in browser</Row>
    </div>
  );
}

/**
 * Content column plus annotation rail.
 *
 * With no `children` in `rail` only the title block stands there — that is the common
 * case, and the reason the rail needs no prop for it.
 */
export function Sheet({
  meta,
  rail,
  children,
}: {
  meta: SheetMeta;
  rail?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="sheet">
      <div>{children}</div>
      <aside className="sheet__rail" aria-label="Render notes">
        <TitleBlock meta={meta} />
        {rail}
      </aside>
    </div>
  );
}

/** A margin note with a leader line. */
export function Note({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="note">
      <span className="note__title">{title}</span>
      {children}
    </div>
  );
}

/**
 * The dimension bracket around a client island.
 *
 * `label` is optional: in the header there is no room beside the bracket, so there the
 * bracket carries the statement alone and the legend sits in the title block.
 *
 * `aria-hidden` on the label, because it is a note for the eye and not part of the
 * control it stands around. Otherwise a screen-reader user hears «client island» before
 * every search field.
 */
export function Island({
  label,
  children,
}: {
  label?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={label === undefined ? "island island--bare" : "island"}>
      {label !== undefined ? (
        <span className="island__mark" aria-hidden="true">
          {label}
        </span>
      ) : null}
      {children}
    </div>
  );
}
