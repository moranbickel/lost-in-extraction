import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./qa",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:8766",
    viewport: { width: 1440, height: 1050 },
    browserName: "chromium",
  },
  webServer: {
    command: "node bin/paper-cuts.js serve --port 8766",
    url: "http://127.0.0.1:8766",
    reuseExistingServer: false,
    timeout: 20000,
  },
});
