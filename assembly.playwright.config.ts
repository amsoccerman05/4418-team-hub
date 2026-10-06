import {defineConfig} from '@playwright/test';
import {existsSync,mkdirSync} from 'node:fs';
const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
const browserHome='/tmp/assembly-ui-browser';
for(const path of [browserHome,`${browserHome}/config`,`${browserHome}/cache`])mkdirSync(path,{recursive:true});
export default defineConfig({
 testDir:'./tests',testMatch:'assembly-ui.spec.ts',fullyParallel:true,workers:3,
 outputDir:'test-results/assembly-runs',reporter:'list',
 use:{baseURL:'http://127.0.0.1:4432',launchOptions:{executablePath,env:{...process.env,HOME:browserHome,XDG_CONFIG_HOME:`${browserHome}/config`,XDG_CACHE_HOME:`${browserHome}/cache`}},screenshot:'only-on-failure',trace:'retain-on-failure'},
 webServer:{command:'npm run dev -- --host 127.0.0.1 --port 4432 --strictPort',url:'http://127.0.0.1:4432',reuseExistingServer:false,env:{VITE_SUPABASE_URL:'https://assembly-test.supabase.invalid',VITE_SUPABASE_ANON_KEY:'test-public-key'}},
});
