import {defineConfig} from '@playwright/test';
import {existsSync} from 'node:fs';
import base from './playwright.config';
const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
export default defineConfig({...base,workers:1,outputDir:'test-results/assembly-regression',reporter:'list',use:{...base.use,baseURL:'http://127.0.0.1:4434',launchOptions:{executablePath,env:{...process.env,HOME:'/tmp/assembly-browser-home',XDG_CONFIG_HOME:'/tmp/assembly-browser-config',XDG_CACHE_HOME:'/tmp/assembly-browser-cache'}}},webServer:{...base.webServer,command:'npm run dev -- --host 127.0.0.1 --port 4434 --strictPort',url:'http://127.0.0.1:4434',reuseExistingServer:false}});
