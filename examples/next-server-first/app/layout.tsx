import type { ReactNode } from "react";
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./styles/tokens.css";
import "./styles/global.css";
import "./styles/catalog.css";
import { Header } from "./components/header";

export const metadata = { title: "Emporix SDK — server-first example" };

/**
 * Drei Schriften, drei Aufgaben — siehe die Begruendung in `styles/tokens.css`.
 *
 * `next/font/google` statt eines @fontsource-Pakets wie in storefront-demo: keine
 * neue Dependency, die Dateien werden zur Build-Zeit selbst gehostet, und next
 * erzeugt eine metrik-angepasste Fallback-Familie, womit der Wechsel ohne
 * Layout-Sprung passiert. `--font-*` landet als CSS-Variable auf `<html>`, wo
 * `tokens.css` sie abholt.
 */
const archivo = Archivo({
  subsets: ["latin"],
  // Die Breitenachse ist der Grund fuer diese Familie. `.display` stellt sie auf
  // 112 — Breitenkontrast statt Stilkontrast, die Bewegung einer technischen
  // Plattenschrift.
  axes: ["wdth"],
  display: "swap",
  variable: "--font-archivo",
});

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-plex-sans",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-plex-mono",
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
    <html
      lang="en"
      className={`${archivo.variable} ${plexSans.variable} ${plexMono.variable}`}
    >
      <body>
        <Header />
        {children}
      </body>
    </html>
  );
}
