import { test, expect } from "../fixtures/test-customer";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("login resolves the customer profile and stores the token", async ({ page, customer }) => {
  await page.goto("/account");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.getByPlaceholder("email").fill(customer.email);
  await page.getByPlaceholder("password").fill(customer.password);
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(
    page.getByText(new RegExp(`Signed in as ${escapeRegExp(customer.email)}`)),
  ).toBeVisible({ timeout: 15_000 });

  const stored = await page.evaluate(() =>
    localStorage.getItem("emporix.customerToken"),
  );
  expect(stored).not.toBeNull();
});

test("logout clears the customer token", async ({ page, customer }) => {
  await page.goto("/account");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.getByPlaceholder("email").fill(customer.email);
  await page.getByPlaceholder("password").fill(customer.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText(/Signed in as/)).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByPlaceholder("email")).toBeVisible();

  const stored = await page.evaluate(() =>
    localStorage.getItem("emporix.customerToken"),
  );
  expect(stored).toBeNull();
});
