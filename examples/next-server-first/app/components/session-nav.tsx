"use client";

import Link from "next/link";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { logout } from "../actions/auth";
import { onSessionChanged } from "../lib/session-changed";

interface Nav {
  cartCount: number;
  loggedIn: boolean;
}

/**
 * The only personalised part of the shell, and the only reason it is a Client
 * Component.
 *
 * It was a Server Component reading the session directly. That single
 * `cookies()` call sat in the root layout, so it made **every** route dynamic —
 * including four catalog pages whose HTML is identical for every visitor. The
 * read now happens in `/api/session/nav`, after the page has already been
 * served.
 *
 * The trade, stated plainly: the badge arrives one round trip late, and with
 * JavaScript off it never arrives at all. That is why the fallback is a working
 * link rather than a spinner — without JS you get a Cart link and a Login link,
 * which is the whole navigation, just without the count. Everything that
 * *changes* state in this demo is still a `<form>` posting to a Server Action.
 */
export function SessionNav({ lang }: { lang: string }): React.JSX.Element {
  const [nav, setNav] = useState<Nav | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    const abort = new AbortController();
    const read = (): void => {
      // Unprefixed on purpose: this route answers with JSON and has no language.
      fetch("/api/session/nav", { signal: abort.signal, cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<Nav>) : null))
        .then((data) => {
          if (data !== null) setNav(data);
        })
        .catch(() => {
          // A failed nav fetch must not break the page. The fallback links below
          // stay, which is exactly what a visitor without JS gets.
        });
    };

    read();
    // Two triggers, because the session changes in two ways this component cannot
    // see. `pathname` in the deps covers a navigation — logging in redirects to
    // `/[lang]/account`, and the layout survives that, so without this the header
    // still offered «Login» on the account page. The event covers a mutation with no
    // navigation, which is what adding to the cart is.
    //
    // Measured before this existed: server `{cartCount: 1}`, header `Cart`, exactly one
    // `/api/session/nav` request in the whole session. `revalidatePath` cannot help —
    // React keeps the state of a client component that stays where it was.
    //
    // `cache: "no-store"` because the answer is per visitor and changes under us; the
    // route already sends `Cache-Control: no-store`, and this says the same on the way
    // out.
    const unsubscribe = onSessionChanged(read);
    return () => {
      // Both, and in this order: stop any in-flight read before dropping the listener
      // that could start another.
      abort.abort();
      unsubscribe();
    };
  }, [pathname]);

  return (
    <>
      <Link href={`/${lang}/cart`} className="u-underline">
        Cart{nav !== null && nav.cartCount > 0 ? ` (${nav.cartCount})` : ""}
      </Link>
      {nav?.loggedIn === true ? (
        <>
          <Link href={`/${lang}/account`} className="u-underline">
            Account
          </Link>
          <form action={logout} style={{ display: "inline" }}>
            <button type="submit" className="btn btn--ghost btn--sm">
              Log out
            </button>
          </form>
        </>
      ) : (
        <Link href={`/${lang}/login`} className="u-underline">
          Login
        </Link>
      )}
    </>
  );
}
