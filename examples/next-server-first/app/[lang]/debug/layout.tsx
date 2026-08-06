import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * A layout that exists **only** to carry metadata.
 *
 * `debug/page.tsx` is a Client Component — it reads `document.cookie` to prove the
 * browser holds no token — and a Client Component cannot export `metadata`. A
 * layout can, it is a Server Component, and metadata resolves down the segment
 * chain, so the page below inherits this without being touched.
 *
 * The alternative was splitting the page into a server shell plus a client child.
 * That is more moving parts for one `<meta>` tag.
 *
 * Why `/debug` is noindex at all although it is prerendered: it describes the demo,
 * not the shop, and the header links to it from every page. See the reasoning on
 * `app/cart/page.tsx`.
 */
export const metadata: Metadata = {
  title: "Debug",
  robots: { index: false, follow: true },
};

export default function DebugLayout({ children }: { children: ReactNode }): React.JSX.Element {
  return <>{children}</>;
}
