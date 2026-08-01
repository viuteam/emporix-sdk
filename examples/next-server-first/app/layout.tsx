import type { ReactNode } from "react";

export const metadata = { title: "Emporix SDK — server-first example" };

/**
 * No provider, no client-side EmporixClient, no storage. That absence is the
 * whole demonstration: the browser has nothing to hold a token in.
 */
export default function RootLayout({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <html lang="en">
      <body>
        <nav>
          <a href="/">Catalog</a> · <a href="/cart">Cart</a> · <a href="/login">Login</a> ·{" "}
          <a href="/debug">Debug</a>
        </nav>
        {children}
      </body>
    </html>
  );
}
