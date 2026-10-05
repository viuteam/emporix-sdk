"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  STORAGE_KEYS,
  emporixLogin,
  emporixLogout,
  emporixSessionHandle,
  withEmporixSessionMutable,
} from "@viu/emporix-sdk-next/session";
import { STORE_OPT } from "../emporix";
import { setCart } from "../lib/cart-session";
import { DEFAULT_LANGUAGE, isLanguage } from "../lib/languages";
import { safeNext } from "../lib/safe-next";
import { emporixOptions } from "../lib/site-context";

/** Read-only, so it costs a handle hydrate and no Emporix call. */
async function readCartId(): Promise<string | null> {
  const handle = await emporixSessionHandle({ readOnly: true, ...STORE_OPT });
  return handle.get(STORAGE_KEYS.cartId);
}

export async function login(formData: FormData): Promise<void> {
  const cartIdBefore = await readCartId();
  await emporixLogin(
    {
      email: String(formData.get("email")),
      password: String(formData.get("password")),
    },
    await emporixOptions(),
  );
  // Only when the onboarding actually swapped the cart. emporixLogin writes the
  // cart id itself, inside the package and therefore outside setCart, so a swap
  // would leave the header showing the guest cart's count.
  //
  // Guarded rather than unconditional: a guest who logs in normally moves onto the
  // customer's cart (the README records the count going from 1 to 4 live), but
  // where nothing moved a re-read would spend a cart GET for nothing. The two
  // handle reads around it are free by comparison. Until 2026-10-05 this comment
  // said the swap never happens on `viu`, from two measurements on 2026-08-03.
  if (cartIdBefore !== (await readCartId())) {
    await withEmporixSessionMutable(async (client, ctx, handle) => {
      const cartId = handle.get(STORAGE_KEYS.cartId);
      if (cartId !== null) setCart(handle, cartId, await client.carts.get(cartId, ctx));
    }, await emporixOptions());
  }
  revalidatePath("/[lang]", "layout");
  // The fallback is the visitor's language home, not `/`: `/` is a proxy redirect now,
  // so returning it would cost a hop after every login that arrived without a `next`.
  //
  // A Server Action gets FormData, not route params, so the language travels as a hidden
  // field — and it is guarded, because a form post is whatever the client sent. Same
  // reason `safeNext` is applied twice in this file.
  const raw = String(formData.get("lang") ?? "");
  const fallback = `/${isLanguage(raw) ? raw : DEFAULT_LANGUAGE}`;
  // safeNext again, not just when the field was rendered: the value arrives in a
  // form post and a form post is whatever the client sent.
  redirect(safeNext(String(formData.get("next") ?? fallback)));
}

export async function logout(): Promise<void> {
  await emporixLogout(await emporixOptions());
  revalidatePath("/[lang]", "layout");
}
