import type { Product } from "@viu/emporix-sdk";
import { pickText, stripHtml } from "@viu/emporix-examples-shared";

/**
 * Everything that normalizes an Emporix read shape lives in
 * `@viu/emporix-examples-shared`, so this demo and the Next one cannot drift.
 * Re-exported here so the ~30 existing import paths keep working.
 *
 * What stays: the two functions that need a browser.
 */
export * from "@viu/emporix-examples-shared";

const UNSAFE_TAGS = "script,style,iframe,object,embed,link,meta,base,form,input,template";

/**
 * Sanitize merchant-authored description HTML for safe rendering. Emporix
 * descriptions may contain markup; we keep it (so it renders, not stripped)
 * but drop script/style/embeds, `on*` handlers and `javascript:` URLs, and
 * harden links. Uses the browser DOMParser — robust parsing, no dependency.
 * For untrusted / user-generated HTML prefer a vetted sanitizer (e.g. DOMPurify).
 *
 * Browser only, which is why it did NOT move into the shared package: there is
 * no `DOMParser` in Node, and a server-rendered consumer would silently get the
 * `stripHtml` fallback while believing it had a sanitizer.
 */
export function sanitizeHtml(html: string): string {
  if (typeof DOMParser === "undefined") return stripHtml(html); // no-DOM fallback
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll(UNSAFE_TAGS).forEach((el) => el.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || /^\s*javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
    if (el.tagName === "A" && el.getAttribute("href")) {
      el.setAttribute("rel", "noopener noreferrer nofollow");
      el.setAttribute("target", "_blank");
    }
  });
  return doc.body.innerHTML.trim();
}

/** Product description as sanitized HTML, ready for `dangerouslySetInnerHTML`. */
export function productDescription(p: Product): string {
  return sanitizeHtml(pickText((p as { description?: unknown }).description, ""));
}
