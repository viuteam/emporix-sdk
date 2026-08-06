import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "../styles/tokens.css";
import "../styles/global.css";
import "../styles/catalog.css";
import { Header } from "../components/header";
import { LANGUAGES, isLanguage } from "../lib/languages";
import { SITE_BASE_URL, SITE_NAME } from "../lib/site-url";

/**
 * **THE** root layout, and `[lang]` sits above it on purpose.
 *
 * Next 16 calls a dynamic segment above the root layout a *root param* —
 * `collect-root-param-keys.js` walks the tree until «we've found the root layout» — and
 * that is what finally lets `<html lang>` tell the truth. Until 2026-08-06 this
 * attribute said `en` on every German page, because the root layout sat at
 * `app/layout.tsx` and could not see this segment; a `<div lang={lang}>` wrapper stood
 * in for it. Both the wrapper and `app/layout.tsx` are gone.
 *
 * The consequence to know before adding a route: **a page outside `[lang]` does not fail
 * the build.** It answers 200 with no `<html>` and no `<body>` — measured, 6'381 bytes
 * of fragment against 30'789 for `/de`. There is no safety net; put every page under
 * `[lang]`.
 *
 * Three faces, three jobs — the reasoning lives in `styles/tokens.css`.
 *
 * `next/font/google` rather than an @fontsource package as storefront-demo uses: no new
 * dependency, the files are self-hosted at build time, and next generates a
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
 * The shell's metadata, and the template every page title goes through.
 *
 * `metadataBase` is what turns the relative `canonical` and `hreflang` values from
 * `lib/seo.ts` into the absolute URLs those tags have to carry. Without it Next warns on
 * every build and emits relative hrefs, which a crawler resolves against whatever host
 * it happened to use.
 */
export const metadata: Metadata = {
  metadataBase: SITE_BASE_URL,
  title: { default: SITE_NAME, template: `%s — ${SITE_NAME}` },
  description:
    "A server-first Emporix storefront: the catalogue is static and cached, the session never reaches the browser.",
};

/**
 * `generateStaticParams` prerenders both languages at build time. It returns a literal
 * rather than asking Emporix, because this decides the *route table*: a build that
 * depends on a network call for a list that changes once a year is a build that fails
 * when the tenant is down.
 */
export function generateStaticParams(): { lang: string }[] {
  return LANGUAGES.map((lang) => ({ lang }));
}

/**
 * No provider, no client-side EmporixClient, no storage. That absence is the whole
 * demonstration: the browser has nothing to hold a token in.
 *
 * The header is a Server Component that makes no Emporix call — the cart count lives in
 * the session — so putting it here costs nothing per page view.
 */
export default async function LangLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ lang: string }>;
}): Promise<React.JSX.Element> {
  const { lang } = await params;
  // `dynamicParams` defaults to true, so `/fr/…` would otherwise render with a language
  // the tenant does not have — and the value goes straight into `Accept-Language` on
  // every Emporix call the page makes.
  if (!isLanguage(lang)) notFound();

  return (
    <html
      lang={lang}
      className={`${archivo.variable} ${plexSans.variable} ${plexMono.variable}`}
    >
      <body>
        <Header lang={lang} />
        {children}
      </body>
    </html>
  );
}
