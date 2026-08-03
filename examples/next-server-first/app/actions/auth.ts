"use server";

import { revalidatePath } from "next/cache";
import {
  STORAGE_KEYS,
  emporixLogin,
  emporixLogout,
  withEmporixSessionMutable,
} from "@viu/emporix-sdk-next/session";
import { EMPORIX } from "../emporix";
import { setCart } from "../lib/cart-session";

export async function login(formData: FormData): Promise<void> {
  await emporixLogin(
    {
      email: String(formData.get("email")),
      password: String(formData.get("password")),
    },
    EMPORIX,
  );
  // emporixLogin folds the guest cart into the customer's and writes the cart id
  // itself — inside the package, so outside setCart. Without this the header
  // would keep showing the guest cart's count after the merge.
  await withEmporixSessionMutable(async (client, ctx, jar) => {
    const cartId = jar.get(STORAGE_KEYS.cartId);
    if (cartId !== null) setCart(jar, await client.carts.get(cartId, ctx));
  }, EMPORIX);
  revalidatePath("/", "layout");
}

export async function logout(): Promise<void> {
  await emporixLogout(EMPORIX);
  revalidatePath("/", "layout");
}
