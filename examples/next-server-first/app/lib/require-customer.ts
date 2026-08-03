import { redirect } from "next/navigation";
import { emporixSession } from "@viu/emporix-sdk-next/session";
import { STORE_OPT } from "../emporix";

/**
 * The gate for account pages: returns the customer token or redirects to login.
 *
 * Per page rather than as middleware, and not by choice — Next 16 runs middleware
 * in `proxy.ts`, which is Node-runtime and has no `cookies()`. Every account page
 * therefore starts with this call.
 *
 * The `?next=` value it writes is validated on the way back out by `safeNext`,
 * which lives in its own module so it can be unit-tested — importing the
 * server-only session entry beside it makes that impossible.
 */
export async function requireCustomer(next: string): Promise<string> {
  const { customerToken } = await emporixSession(STORE_OPT);
  if (customerToken === null) redirect(`/login?next=${encodeURIComponent(next)}`);
  return customerToken;
}
