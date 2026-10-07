import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests',testMatch:['meals-gateway.spec.ts','meals-db.spec.ts','meals-service.spec.ts','meals-model.spec.ts','meals-review.spec.ts'],workers:1,timeout:30000});
