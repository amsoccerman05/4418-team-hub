export default {
  testDir: '.', testMatch: 'inventory-return.spec.ts', workers: 1, timeout: 60000,
  use: {headless: true, launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {}},
};
