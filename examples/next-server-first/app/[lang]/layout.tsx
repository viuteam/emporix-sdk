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
  return <>{children}</>;
}
