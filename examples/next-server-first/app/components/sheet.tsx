/**
 * Das Blatt und sein Schriftfeld — das Signature-Element dieser Demo.
 *
 * Eine Referenz-Implementierung ist eine annotierte Zeichnung, und eine Zeichnung
 * hat in der Blattecke eine Tabelle, die sagt, was man vor sich hat. Hier sagt sie,
 * **wie diese Route gerendert wurde**: statisch oder pro Anfrage, mit welcher
 * Revalidierung, und wie viele Stellen der Seite im Browser hydrieren.
 *
 * Das ist die interessanteste Information, die diese Demo hat, und sie stand bisher
 * nirgends — nur auf `/debug`, also ausgerechnet nicht dort, wo man sie sehen will.
 *
 * **Die Angaben sind Handarbeit, und das ist eine Entscheidung.** Man koennte den
 * Render-Modus zur Laufzeit erraten, aber jeder Weg dorthin faelscht das Ergebnis:
 * `cookies()` oder `headers()` zu lesen, um herauszufinden, ob eine Route statisch
 * ist, macht sie dynamisch. Eine Zeile pro Seite, die die Wahrheit aus dem
 * `next build` wiederholt, ist ehrlicher als eine Ableitung, die ihren eigenen
 * Gegenstand kaputt macht — und `next build` ist der Test dafuer: steht dort ein
 * `●` und hier `DYNAMIC`, ist eines von beiden falsch.
 */

/** Wie Next diese Route gebaut hat — die Spalte «Route» aus `next build`. */
export type RenderMode = "static" | "dynamic";

export interface SheetMeta {
  /** Das Routen-Muster, nicht die aufgeloeste URL. */
  route: string;
  render: RenderMode;
  /** Sekunden, wie in `export const revalidate`. Fehlt bei dynamischen Routen. */
  revalidate?: number;
  /** Warum diese Route pro Anfrage rendert. Nur bei `dynamic` sinnvoll. */
  because?: string;
  /**
   * Die Client-Inseln DIESER Seite, als Phrasen und nicht als Zahl.
   *
   * Hier stand zuerst eine Liste von Namen, und das Schriftfeld rechnete
   * `laenge + 2` daraus. Auf dem Warenkorb war das Ergebnis falsch: jedes
   * Mutations-Formular ist ein `ActionForm` und damit eine eigene Insel, die Zahl
   * waechst also mit den Positionen. Ein Schriftfeld, das rechnet, kann falsch
   * rechnen — dieses zaehlt nicht mehr, es nennt.
   */
  islands?: string[];
}

function seconds(s: number): string {
  if (s % 3600 === 0) return `${s / 3600}h`;
  if (s % 60 === 0) return `${s / 60}min`;
  return `${s}s`;
}

/** Eine Zeile im Schriftfeld. */
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
 * Das Schriftfeld allein. Steht in der Marginalie, kann aber auch ohne sie stehen —
 * `/debug` benutzt es so.
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
        {/* Der Header steckt im Root-Layout, seine zwei Inseln — Sprachwahl und
            Sitzungs-Navigation — hydrieren also auf jeder Seite. Sie stehen als
            «2 shell» da, weil sie nicht zur Seite gehoeren. */}
        {["2 shell", ...islands].join(" + ")}
      </Row>
      <Row k="Token">none in browser</Row>
    </div>
  );
}

/**
 * Inhaltsspalte plus Annotations-Marginalie.
 *
 * Ohne `children` in `rail` steht dort nur das Schriftfeld — das ist der haeufige
 * Fall und der Grund, warum die Marginalie kein Prop dafuer braucht.
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

/** Eine Randnotiz mit Hinweislinie. */
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
 * Die Massklammer um eine Client-Insel.
 *
 * `label` ist optional: im Header ist neben der Klammer kein Platz, dort traegt sie
 * die Aussage allein und die Legende steht im Schriftfeld.
 *
 * `aria-hidden` auf der Beschriftung, weil sie eine Anmerkung fuer das Auge ist und
 * nicht Teil des Bedienelements, um das sie steht. Ein Screenreader-Nutzer hoert
 * sonst «client island» vor jedem Suchfeld.
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
