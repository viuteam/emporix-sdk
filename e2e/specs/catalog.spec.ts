import { test, expect } from "@playwright/test";

test("anonymous catalog renders 12 products", async ({ page }) => {
  await page.goto("/");
  // Allow the anonymous-login + product-list calls to settle.
  await expect(page.locator("ul li")).toHaveCount(12, { timeout: 15_000 });
});

test("only anonymous-login + product-list + site-by-code hit Emporix on /", async ({ page }) => {
  const calls: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (!url.includes("api.emporix.io")) return;
    if (req.method() === "OPTIONS") return;
    calls.push(`${req.method()} ${new URL(url).pathname}`);
  });
  await page.goto("/");
  await expect(page.locator("ul li")).toHaveCount(12, { timeout: 15_000 });
  // Order between product-list and site-by-code is not deterministic — assert
  // the set rather than the sequence. MS-4 adds the site-by-code fetch when
  // the static config has a siteCode set, so currency + targetLocation can
  // populate via `useSiteContext()`.
  expect(new Set(calls)).toEqual(
    new Set([
      "GET /customerlogin/auth/anonymous/login",
      "GET /product/viu/products",
      "GET /site/viu/sites/main",
    ]),
  );
});
