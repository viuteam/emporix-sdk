import { test, expect } from "../fixtures/test-customer";
import { fillSecret } from "../fixtures/secret-input";

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
  await fillSecret(page, 'input[placeholder="email"]', customer.email);
  await fillSecret(page, 'input[placeholder="password"]', customer.password);
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

  // 4. Storage now holds a customer cart id.
  //
  // Note: we deliberately do NOT assert `customerCartId !== guestCartId`.
  // Emporix's merge endpoint may optimize an empty-cart merge by "promoting"
  // the anonymous cart to the customer (same id, status flipped). What
  // matters for the user is that (a) the onboarding HTTP calls fire (asserted
  // above) and (b) the storefront has a valid cartId to drive `useCart`
  // afterwards.
  const customerCartId = await page.evaluate(() =>
    localStorage.getItem("emporix.cartId"),
  );
  expect(customerCartId).not.toBeNull();
  expect(typeof customerCartId).toBe("string");
  expect((customerCartId as string).length).toBeGreaterThan(0);
});
