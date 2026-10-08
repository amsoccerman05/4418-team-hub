import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests',testMatch:'meals-ui.spec.ts',grep:/static /,workers:1,timeout:30000});
