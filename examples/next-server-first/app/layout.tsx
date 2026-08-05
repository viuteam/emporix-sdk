import type { ReactNode } from "react";
import { Fraunces, Hanken_Grotesk } from "next/font/google";
import "./styles/tokens.css";
import "./styles/global.css";
import "./styles/catalog.css";
import { Header } from "./components/header";

export const metadata = { title: "Emporix SDK — server-first example" };

/**
 * Die zwei Schriften, die `tokens.css` schon immer verlangt hat.
 *
 * Sie fehlten: die Datei nennt «Fraunces Variable» und «Hanken Grotesk Variable»,
 * geladen hat sie nie jemand, also rendert alles in Georgia und system-ui —
 * gemessen am 2026-08-05, `document.fonts` enthielt ausser den Next-Devtools
 * nichts. storefront-demo laedt @fontsource; hier ist `next/font/google` richtig,
 * weil es keine Dependency braucht, die Dateien zur Build-Zeit selbst hostet und
 * eine metrik-angepasste Fallback-Familie erzeugt.
 *
 * `--font-*` landet als CSS-Variable auf `<html>`, wo `tokens.css` sie abholt.
 */
const fraunces = Fraunces({
  subsets: ["latin"],
  // `opsz`, weil global.css `font-optical-sizing: auto` setzt. `SOFT` und `WONK`
  // sind die Achsen, die Fraunces von einer beliebigen Serif unterscheiden.
  axes: ["SOFT", "WONK", "opsz"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-fraunces",
});

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-hanken",
});

/**
 * No provider, no client-side EmporixClient, no storage. That absence is the
 * whole demonstration: the browser has nothing to hold a token in.
 *
 * The header is a Server Component that makes no Emporix call — the cart count
 * lives in the session — so putting it in the root layout costs nothing per page
 * view.
 */
export default function RootLayout({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <html lang="en" className={`${fraunces.variable} ${hanken.variable}`}>
      <body>
        <Header />
        {children}
      </body>
    </html>
  );
}
