import { defineConfig, devices } from "@playwright/test";

// Playwright reads no `.env` file on its own. `docs/e2e.md` was right about this
// and told you to `set -a; source e2e/.env.local` first — but forgetting that step
// does not fail, it makes every spec using the `customer` fixture **skip**, and a
// skip reads like a pass. It had been skipping locally with the file sitting right
// here. `process.loadEnvFile` is Node's own (20.6+), so the file is now enough and
// there is one less step to forget.
try {
  process.loadEnvFile(".env.local");
} catch {
  // No file, or unreadable. The customer specs then skip with the reason printed
  // by `fixtures/test-customer.ts`, which is the documented behaviour for anyone
  // without viu access.
}

const PORT = 5173;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./specs",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm -F @viu/emporix-examples-vite-spa dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      VITE_EMPORIX_TENANT: process.env.VITE_EMPORIX_TENANT ?? "viu",
      VITE_EMPORIX_STOREFRONT_CLIENT_ID:
        process.env.VITE_EMPORIX_STOREFRONT_CLIENT_ID ??
        "miFWH87by6AsfQxFSloirT8AV3IZL3seSaC3oR7phbGMV1hO",
    },
  },
});
