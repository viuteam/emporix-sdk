import { test as base, expect } from "@playwright/test";

interface Creds {
  email: string;
  password: string;
}

function readCreds(): Creds | null {
  const email = process.env.EMPORIX_TEST_CUSTOMER_EMAIL;
  const password = process.env.EMPORIX_TEST_CUSTOMER_PASSWORD;
  if (!email || !password) return null;
  return { email, password };
}

/**
 * Test fixture that exposes the test customer's credentials. Reads from
 * `EMPORIX_TEST_CUSTOMER_EMAIL` and `EMPORIX_TEST_CUSTOMER_PASSWORD`.
 * Tests using `customer` are skipped (not failed) when the env vars are
 * unset — keeps the suite green for contributors without viu access.
 */
export const test = base.extend<{ customer: Creds }>({
  customer: async ({}, use) => {
    const creds = readCreds();
    test.skip(!creds, "EMPORIX_TEST_CUSTOMER_EMAIL/_PASSWORD not set");
    await use(creds as Creds);
  },
});

export { expect };
