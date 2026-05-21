import { test, expect } from "@playwright/test";

test("anonymous catalog renders 12 products", async ({ page }) => {
  await page.goto("/");
  // Allow the anonymous-login + product-list calls to settle.
  await expect(page.locator("ul li")).toHaveCount(12, { timeout: 15_000 });
});

test("only anonymous-login + product-list hit Emporix on /", async ({ page }) => {
  const calls: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (!url.includes("api.emporix.io")) return;
    if (req.method() === "OPTIONS") return;
    calls.push(`${req.method()} ${new URL(url).pathname}`);
  });
  await page.goto("/");
  await expect(page.locator("ul li")).toHaveCount(12, { timeout: 15_000 });
  expect(calls).toEqual([
    "GET /customerlogin/auth/anonymous/login",
    "GET /product/viu/products",
  ]);
});
