import type { NextRequest } from "next/server";
import { emporixTokenProxy } from "@viu/emporix-sdk-next/bff";

export async function proxy(request: NextRequest) {
  // Rotates the customer token when it is close to expiry and pins the site.
  // A Server Component cannot write cookies, so this is the only place that can.
  return emporixTokenProxy(request, { site: { siteCode: "main" } });
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
