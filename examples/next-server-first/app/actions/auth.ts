"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  STORAGE_KEYS,
  emporixLogin,
  emporixLogout,
  sessionCookieJar,
  withEmporixSessionMutable,
} from "@viu/emporix-sdk-next/session";
import { EMPORIX, STORE_OPT } from "../emporix";
import { setCart } from "../lib/cart-session";
import { safeNext } from "../lib/safe-next";

/** Read-only, so it costs a jar hydrate and no Emporix call. */
async function readCartId(): Promise<string | null> {
  const jar = await sessionCookieJar({ readOnly: true, ...STORE_OPT });
  return jar.get(STORAGE_KEYS.cartId);
}

export async function login(formData: FormData): Promise<void> {
  const cartIdBefore = await readCartId();
  await emporixLogin(
    {
      email: String(formData.get("email")),
      password: String(formData.get("password")),
    },
    EMPORIX,
  );
  // Only when the onboarding actually swapped the cart. emporixLogin writes the
  // cart id itself, inside the package and therefore outside setCart, so a swap
  // would leave the header showing the guest cart's count.
  //
  // Guarded rather than unconditional because the swap is rare: on the `viu`
  // tenant it never happens — the customer login refreshes the same anonymous
  // session, Emporix binds the cart to it, and `getCurrent` answers with the
  // guest cart. Measured twice on 2026-08-03. An unconditional re-read would
  // spend a cart GET on every login to fix a path this tenant does not take;
  // the two jar reads around it are free by comparison.
  if (cartIdBefore !== (await readCartId())) {
    await withEmporixSessionMutable(async (client, ctx, jar) => {
      const cartId = jar.get(STORAGE_KEYS.cartId);
      if (cartId !== null) setCart(jar, cartId, await client.carts.get(cartId, ctx));
    }, EMPORIX);
  }
  revalidatePath("/", "layout");
  // safeNext again, not just when the field was rendered: the value arrives in a
  // form post and a form post is whatever the client sent.
  redirect(safeNext(String(formData.get("next") ?? "/")));
}

export async function logout(): Promise<void> {
  await emporixLogout(EMPORIX);
  revalidatePath("/", "layout");
}
