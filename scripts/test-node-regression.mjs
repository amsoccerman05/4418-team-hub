// Isolate each browser-free test file in a fresh process: PGlite/WASM memory is
// then returned to the OS between files in small local execution environments.
import {mkdtempSync,readdirSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
const root=process.cwd(),temp=mkdtempSync(join(tmpdir(),'assembly-node-suite-')),logDir=resolve('test-results/node-regression');
const extra=new Set(['fabrication-files.spec.ts','invitation-email.spec.ts','onboarding-dispatch.spec.ts','workspace-presentation.spec.ts','sprint-review-export-xml.spec.ts','sprint-review-export.spec.ts','onboarding-contract.spec.ts','personal-attention.spec.ts','team-invitations.spec.ts','recurrence.spec.ts','invitation-batch.spec.ts','assembly-presentation.spec.ts']);
const files=readdirSync('tests').filter(f=>/-db\.spec\.ts$|-model\.spec\.ts$/.test(f)||extra.has(f)).sort();
let passed=0;const failed=[];
try{
 mkdirSync(logDir,{recursive:true});const config=join(temp,'playwright.config.cjs');writeFileSync(config,`module.exports={testDir:${JSON.stringify(join(root,'tests'))},grepInvert:/the browser export needs/,workers:1,reporter:'list',outputDir:${JSON.stringify(join(temp,'results'))}};`);
 for(const file of files){const run=spawnSync(process.execPath,[join(root,'node_modules/@playwright/test/cli.js'),'test','--config='+config,file],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024,env:process.env});const output=(run.stdout||'')+(run.stderr||'');writeFileSync(join(logDir,file+'.log'),output);const count=Number(/^\s*(\d+) passed\b/m.exec(output)?.[1]||0);passed+=count;if(run.status!==0){failed.push(file);console.log(`FAIL ${file}: ${run.signal||run.status}; see ${join(logDir,file+'.log')}`);}else console.log(`PASS ${file}: ${count}`);}
 console.log(`${passed} browser-free tests passed across ${files.length} isolated files; ${failed.length} failed files.`);if(failed.length)process.exitCode=1;
}finally{rmSync(temp,{recursive:true,force:true});}
