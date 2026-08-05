import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { emporixSiteProxy } from "../src/proxy";

// The cookie names are written out rather than imported from COOKIE_NAMES on
// purpose: a test that imports the constant it asserts against tests nothing.
const SITE = "emporix.siteCode";
const LANG = "emporix.language";

describe("emporixSiteProxy", () => {
  it("sets both cookies when the request carries none", () => {
    const request = new NextRequest("https://shop.test/de/x");
    const response = emporixSiteProxy(request, { siteCode: "main", language: "de" });
    expect(response.cookies.get(SITE)?.value).toBe("main");
    expect(response.cookies.get(LANG)?.value).toBe("de");
  });

  it("injects the values into the forwarded request cookie header", () => {
    const request = new NextRequest("https://shop.test/de/x");
    emporixSiteProxy(request, { siteCode: "main", language: "de" });
    const cookie = request.headers.get("cookie") ?? "";
    expect(cookie).toContain(`${SITE}=main`);
    expect(cookie).toContain(`${LANG}=de`);
  });

  it("writes nothing when both cookies already match", () => {
    const request = new NextRequest("https://shop.test/de/x", {
      headers: { cookie: `${SITE}=main; ${LANG}=de` },
    });
    const response = emporixSiteProxy(request, { siteCode: "main", language: "de" });
    expect(response.cookies.getAll()).toHaveLength(0);
  });

  it("sets only the field that was resolved", () => {
    const request = new NextRequest("https://shop.test/de/x");
    const response = emporixSiteProxy(request, { language: "de" });
    expect(response.cookies.getAll()).toHaveLength(1);
    expect(response.cookies.get(LANG)?.value).toBe("de");
    expect(response.cookies.get(SITE)).toBeUndefined();
  });

  it("passes the request through untouched for an empty resolution", () => {
    const request = new NextRequest("https://shop.test/x");
    const response = emporixSiteProxy(request, {});
    expect(response.cookies.getAll()).toHaveLength(0);
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("rewrites to a relative target resolved against the request url", () => {
    const request = new NextRequest("https://shop.test/de/shoes");
    const response = emporixSiteProxy(request, { language: "de" }, "/shoes");
    // Rewrite target lands in x-middleware-rewrite — see
    // next/dist/server/web/spec-extension/response.js:118. If this assertion
    // ever fails on a Next upgrade, that line is where the name moved.
    expect(response.headers.get("x-middleware-rewrite")).toBe("https://shop.test/shoes");
    expect(response.cookies.get(LANG)?.value).toBe("de");
  });

  it("rewrites to an absolute URL target", () => {
    const request = new NextRequest("https://shop.test/de/shoes");
    const response = emporixSiteProxy(
      request,
      { language: "de" },
      new URL("https://shop.test/shoes"),
    );
    expect(response.headers.get("x-middleware-rewrite")).toBe("https://shop.test/shoes");
    expect(response.cookies.get(LANG)?.value).toBe("de");
  });

  it("marks the cookie Secure only over https", () => {
    // One field only, so `get("set-cookie")` is a single unambiguous value.
    const secure = emporixSiteProxy(new NextRequest("https://shop.test/x"), {
      language: "de",
    });
    expect(secure.headers.get("set-cookie")).toContain("Secure");

    const plain = emporixSiteProxy(new NextRequest("http://shop.test/x"), {
      language: "de",
    });
    expect(plain.headers.get("set-cookie")).not.toContain("Secure");
  });

  it("never marks the site cookies HttpOnly", () => {
    // The browser-side createCookieStorage must read these, or the storage
    // precedence step in SiteContextProvider never fires.
    const response = emporixSiteProxy(new NextRequest("https://shop.test/x"), {
      language: "de",
    });
    expect(response.headers.get("set-cookie")).not.toContain("HttpOnly");
  });

  it("overwrites a cookie whose value differs", () => {
    const request = new NextRequest("https://shop.test/de/x", {
      headers: { cookie: `${LANG}=fr` },
    });
    const response = emporixSiteProxy(request, { language: "de" });
    expect(response.cookies.get(LANG)?.value).toBe("de");
    const cookie = request.headers.get("cookie") ?? "";
    expect(cookie).toContain(`${LANG}=de`);
    expect(cookie).not.toContain(`${LANG}=fr`);
  });

  it("persists on a real document navigation", () => {
    const request = new NextRequest("https://shop.test/de/x", {
      headers: { "Sec-Fetch-Mode": "navigate" },
    });
    const response = emporixSiteProxy(request, { siteCode: "main", language: "de" });
    expect(response.cookies.get(LANG)?.value).toBe("de");
    expect(response.cookies.get(SITE)?.value).toBe("main");
  });

  it("persists NOTHING on a fetch-based request", () => {
    // The case this is about: a `<Link>` prefetch of a route in the other language
    // must not switch the visitor's language. A prefetch and a client-side
    // navigation are both `cors`.
    const request = new NextRequest("https://shop.test/en/x", {
      headers: { cookie: `${LANG}=de`, "Sec-Fetch-Mode": "cors" },
    });
    const response = emporixSiteProxy(request, { siteCode: "main", language: "en" });
    expect(response.cookies.get(LANG)).toBeUndefined();
    expect(response.cookies.get(SITE)).toBeUndefined();
  });

  it("still injects into the forwarded request cookies", () => {
    // Only persistence drops away. This request's render should still see the
    // language of its own URL — that is per-request and does not stick.
    const request = new NextRequest("https://shop.test/en/x", {
      headers: { cookie: `${LANG}=de`, "Sec-Fetch-Mode": "cors" },
    });
    emporixSiteProxy(request, { siteCode: "main", language: "en" });
    expect(request.headers.get("cookie") ?? "").toContain(`${LANG}=en`);
  });

  it("keeps persisting when the client sends no Sec-Fetch-Mode", () => {
    // Fail-open: old clients, curl and bots send none. A prefetch always comes from
    // a browser that sets it, so the assumption costs nothing.
    const request = new NextRequest("https://shop.test/de/x");
    const response = emporixSiteProxy(request, { language: "de" });
    expect(response.cookies.get(LANG)?.value).toBe("de");
  });
});
