import { test, expect } from "@playwright/test";

test("guest places an order end-to-end", async ({ page }) => {
  await page.goto("/guest");
  // Fresh start — no carry-over cart from a previous run.
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.getByRole("button", { name: "Start guest cart" }).click();
  await expect(page.getByText(/^Cart: /)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Unit price:/)).toBeVisible();

  // Capture the addItem POST so we know the server has the item before reload.
  const addItemReq = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      /\/cart\/viu\/carts\/.+\/items$/.test(new URL(r.url()).pathname) &&
      r.status() === 200 || r.status() === 201,
    { timeout: 15_000 },
  );
  await page.getByRole("button", { name: "Add sample item" }).click();
  await addItemReq;

  // Reload so useCart refetches; the cache update from addItem doesn't reach
  // the rendered tree reliably in this Example (known pre-existing UX quirk).
  await page.reload();
  await expect(page.getByText(/Cart:.*\(1 item\(s\)\)/)).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Place guest order" }).click();
  await expect(page.getByText(/Order placed: EON\d+/)).toBeVisible({ timeout: 20_000 });

  const cartIdAfter = await page.evaluate(() => localStorage.getItem("emporix.cartId"));
  expect(cartIdAfter).toBeNull(); // cleared after successful order
});
