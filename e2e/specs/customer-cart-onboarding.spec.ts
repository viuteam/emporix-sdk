import { test, expect } from "../fixtures/test-customer";

test("guest cart is merged into the customer cart on login", async ({ page, customer }) => {
  // 1. Fresh start, create guest cart.
  await page.goto("/guest");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "Start guest cart" }).click();
  await expect(page.getByText(/^Cart: /)).toBeVisible({ timeout: 15_000 });
  const guestCartId = await page.evaluate(() =>
    localStorage.getItem("emporix.cartId"),
  );
  expect(guestCartId).not.toBeNull();

  // 2. Observe cart-related Emporix calls during login.
  const cartCalls: { method: string; path: string }[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (!url.includes("api.emporix.io")) return;
    if (req.method() === "OPTIONS") return;
    const path = new URL(url).pathname;
    if (path.includes("/cart/")) cartCalls.push({ method: req.method(), path });
  });

  // 3. Log in.
  await page.goto("/account");
  await page.getByPlaceholder("email").fill(customer.email);
  await page.getByPlaceholder("password").fill(customer.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText(/Signed in as/)).toBeVisible({ timeout: 15_000 });

  // Give the best-effort onboarding block (getCurrent + merge) time to run.
  await expect
    .poll(() => cartCalls.some((c) => c.method === "GET" && c.path === "/cart/viu/carts"), {
      timeout: 15_000,
    })
    .toBe(true);
  await expect
    .poll(
      () =>
        cartCalls.some(
          (c) => c.method === "POST" && c.path.endsWith("/merge"),
        ),
      { timeout: 15_000 },
    )
    .toBe(true);

  // 4. Storage now holds the customer cart id (different from the guest one).
  const customerCartId = await page.evaluate(() =>
    localStorage.getItem("emporix.cartId"),
  );
  expect(customerCartId).not.toBeNull();
  expect(customerCartId).not.toBe(guestCartId);
});
