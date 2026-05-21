import { defineConfig, devices } from "@playwright/test";

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
    ? "github"
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
