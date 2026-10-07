import base from "./volunteer.playwright.config";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  ...base,
  testMatch: ["**/*-db.spec.ts", "**/*-model.spec.ts"],
});
