"use server";

import { cookies } from "next/headers";
import { EmporixClient } from "@viu/emporix-sdk";

const sdk = new EmporixClient({
  tenant: process.env.NEXT_PUBLIC_EMPORIX_TENANT ?? "mytenant",
  // login() uses the anonymous (storefront) context — no backend secret needed.
  credentials: {
    storefront: { clientId: process.env.EMPORIX_STOREFRONT_CLIENT_ID ?? "" },
  },
  logger: false,
});

/** Logs the customer in and stores the token in an httpOnly cookie. */
export async function loginAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email"));
  const password = String(formData.get("password"));
  const session = await sdk.customers.login({ email, password });
  cookies().set("emporix.customerToken", session.customerToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
  });
}
