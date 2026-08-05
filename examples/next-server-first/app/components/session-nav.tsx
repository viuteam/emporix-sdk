"use client";

import { useEffect, useState } from "react";
import { logout } from "../actions/auth";

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
export function SessionNav(): React.JSX.Element {
  const [nav, setNav] = useState<Nav | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/session/nav", { signal: abort.signal })
      .then((r) => (r.ok ? (r.json() as Promise<Nav>) : null))
      .then((data) => {
        if (data !== null) setNav(data);
      })
      .catch(() => {
        // A failed nav fetch must not break the page. The fallback links below
        // stay, which is exactly what a visitor without JS gets.
      });
    return () => abort.abort();
  }, []);

  return (
    <>
      <a href="/cart" className="u-underline">
        Cart{nav !== null && nav.cartCount > 0 ? ` (${nav.cartCount})` : ""}
      </a>
      {nav?.loggedIn === true ? (
        <>
          <a href="/account" className="u-underline">
            Account
          </a>
          <form action={logout} style={{ display: "inline" }}>
            <button type="submit" className="btn btn--ghost btn--sm">
              Log out
            </button>
          </form>
        </>
      ) : (
        <a href="/login" className="u-underline">
          Login
        </a>
      )}
    </>
  );
}
