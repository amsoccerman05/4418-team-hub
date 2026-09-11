import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/suite",
  workers: 1,
  use: { headless: true },
  timeout: 30000,
});
