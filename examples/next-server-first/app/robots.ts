import type { MetadataRoute } from "next";
import { absoluteUrl } from "./lib/site-url";

/**
 * `/robots.txt` — and until 2026-08-06 this URL answered **500**.
 *
 * `/[lang]` matches any single path segment, `robots.txt` included, and the
 * language guard used to sit behind the Emporix call instead of in front of it. A
 * metadata route beats a dynamic segment, so this file also takes the URL out of
 * `/[lang]`'s reach — measured: `200 text/plain` with this file, 500 without it.
 * It is the belt to the guard's braces in `lib/site-context.ts`; neither replaces
 * the other, because every *other* dotted URL depends on the guard alone.
 *
 * A 5xx here is the most expensive answer this app can give: a crawler that gets
 * one stops crawling the host rather than guessing.
 *
 * The disallow list is the routes that are `ƒ` for a reason — per visitor, or an
 * unbounded query space. `/debug` is on it although it is prerendered: it
 * describes the demo, not the shop, and it is linked from every page.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/search", "/cart", "/checkout", "/login", "/account", "/debug", "/api/"],
      },
    ],
    // Absolute, because the sitemaps protocol says so — a relative path here is
    // dropped by every crawler that reads it strictly.
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
