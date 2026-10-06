import {defineConfig} from '@playwright/test';

// Standalone checks do not start the app or require a Supabase connection.
export default defineConfig({
  testDir: '../../tests',
  testMatch: 'invitation-email*.spec.ts',
  outputDir: '../../test-results/invitation-email',
  use: {
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? {executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}
      : {},
  },
});
