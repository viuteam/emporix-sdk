import type { ReactNode } from "react";
import "./styles/tokens.css";
import "./styles/global.css";
import { Header } from "./components/header";

export const metadata = { title: "Emporix SDK — server-first example" };

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
    <html lang="en">
      <body>
        <Header />
        {children}
      </body>
    </html>
  );
}
