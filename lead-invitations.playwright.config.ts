import {defineConfig} from '@playwright/test';
import {existsSync} from 'node:fs';
import base from './playwright.config';
const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
export default defineConfig({...base,workers:1,outputDir:'test-results/lead-invitations',reporter:'list',use:{...base.use,baseURL:'http://127.0.0.1:4441',launchOptions:{executablePath,env:{...process.env,HOME:'/tmp/lead-invite-browser',XDG_CONFIG_HOME:'/tmp/lead-invite-browser-config',XDG_CACHE_HOME:'/tmp/lead-invite-browser-cache'}}},webServer:{...base.webServer,command:'npm run dev -- --host 127.0.0.1 --port 4441 --strictPort',url:'http://127.0.0.1:4441',reuseExistingServer:false}});
