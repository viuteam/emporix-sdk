"use server";

import { emporixSessionMutable } from "@viu/emporix-sdk-next";
import { emporix } from "./emporix";

/** Logs the customer in and stores the token in an httpOnly cookie. */
export async function loginAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email"));
  const password = String(formData.get("password"));
  // Untagged: anything touching a customer token must not go through the tagged
  // client. (The login POST is untaggable anyway — this is the habit.)
  const session = await emporix({ tagged: false }).customers.login({ email, password });
  // httpOnly, secure, sameSite=lax, path=/ are the defaults.
  const { storage } = await emporixSessionMutable();
  storage.setCustomerToken(session.customerToken);
}
