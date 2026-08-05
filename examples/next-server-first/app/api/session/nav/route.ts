import { emporixSession, emporixSessionHandle } from "@viu/emporix-sdk-next/session";
import { STORE_OPT } from "../../../emporix";
import { cartCount } from "../../../lib/cart-session";

/**
 * The two facts the shell needs about the visitor, and nothing else.
 *
 * This route exists so the header does **not** have to read the session during a
 * render. A `cookies()` call anywhere in the tree makes the whole route dynamic
 * — including the catalog pages, which are identical for every visitor and
 * belong in a CDN. Moving the read here is what buys `/[lang]/…` its `revalidate`.
 *
 * Still no Emporix call and still no Emporix token in the browser: the count
 * comes from the session record (`lib/cart-session.ts`), «am I logged in» from
 * whether a token is stored, and the browser only ever talks to this app.
 *
 * `no-store` is not optional. This answer is per visitor; a CDN that cached it
 * would show one shopper's cart count to the next.
 */
export async function GET(): Promise<Response> {
  const handle = await emporixSessionHandle({ readOnly: true, ...STORE_OPT });
  const { customerToken } = await emporixSession(STORE_OPT);

  return Response.json(
    { cartCount: cartCount(handle), loggedIn: customerToken !== null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
