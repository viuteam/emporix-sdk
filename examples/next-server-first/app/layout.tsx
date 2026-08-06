import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./styles/tokens.css";
import "./styles/global.css";
import "./styles/catalog.css";
import { Header } from "./components/header";
import { SITE_BASE_URL, SITE_NAME } from "./lib/site-url";

/**
 * The shell's metadata, and the template every page title goes through.
 *
 * Until 2026-08-06 this was one line with one title, and all 22 routes shared it —
 * measured: the product page, the cart and the category listing all said «Emporix
 * SDK — server-first example». A `template` means each page returns only its own
 * half and the site name is written once.
 *
 * `metadataBase` is what turns the relative `canonical` and `hreflang` values from
 * `lib/seo.ts` into the absolute URLs those tags have to carry. Without it Next
 * warns on every build and emits relative hrefs, which a crawler resolves against
 * whatever host it happened to use.
 */
export const metadata: Metadata = {
  metadataBase: SITE_BASE_URL,
  title: { default: SITE_NAME, template: `%s — ${SITE_NAME}` },
  description:
    "A server-first Emporix storefront: the catalogue is static and cached, the session never reaches the browser.",
};

/**
 * Three faces, three jobs — the reasoning lives in `styles/tokens.css`.
 *
 * `next/font/google` rather than an @fontsource package as storefront-demo uses: no
 * new dependency, the files are self-hosted at build time, and next generates a
 * metric-matched fallback family so the swap happens without a layout shift.
 * `--font-*` lands as a CSS variable on `<html>`, where `tokens.css` picks it up.
 */
const archivo = Archivo({
  subsets: ["latin"],
  // The width axis is the reason for this family. `.display` sets it to 112 — width
  // contrast instead of style contrast, the move of a technical plate lettering.
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
