import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { LANGUAGES, isLanguage } from "../lib/languages";

/**
 * Owns the `lang` segment — the reason the catalog can be cached at all.
 *
 * The language used to come from a cookie (`lib/site-context.ts`), and a
 * `cookies()` read makes a route dynamic for good: no `revalidate`, no ISR, no
 * CDN, every visitor gets a fresh render of HTML that is identical for all of
 * them. In the URL it is just a route parameter, and the four pages below turn
 * static.
 *
 * `generateStaticParams` prerenders both languages at build time. It returns a
 * literal rather than asking Emporix, because this decides the *route table*:
 * a build that depends on a network call for a list that changes once a year is
 * a build that fails when the tenant is down.
 */
export function generateStaticParams(): { lang: string }[] {
  return LANGUAGES.map((lang) => ({ lang }));
}

export default async function LangLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ lang: string }>;
}): Promise<React.JSX.Element> {
  const { lang } = await params;
  // `dynamicParams` defaults to true, so `/fr/…` would otherwise render with a
  // language the tenant does not have — and the value goes straight into
  // `Accept-Language` on every Emporix call the page makes.
  if (!isLanguage(lang)) notFound();
  // `lang` on a wrapper, because only the ROOT layout may render `<html>` and it
  // cannot see this segment's params. `lang` is valid on any element and the
  // nearest ancestor wins, so this is correct for assistive technology and for the
  // crawlers that read the attribute at all — while `<html lang="en">` stays true
  // of the shell around it, whose UI text really is English.
  //
  // The two proper fixes both cost more than this demo should spend here: two root
  // layouts via route groups turns every navigation between the catalog and a
  // session route into a full document load, and moving the session routes under
  // `/[lang]/…` is option B in
  // docs/superpowers/specs/2026-08-05-language-write-from-proxy.md.
  //
  // The wrapper is layout-neutral: global.css styles `html` and `body` only, with
  // no `body > *` rule and no flex or grid on `body`.
  return <div lang={lang}>{children}</div>;
}
