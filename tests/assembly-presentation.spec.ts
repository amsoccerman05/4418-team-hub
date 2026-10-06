import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('offline synthetic preview renders the actual project facts with immutable provenance and no runtime connection',()=>{
 const temp=mkdtempSync(join(tmpdir(),'assembly-presentation-test-'));try{const output=join(temp,'preview.html');execFileSync(process.execPath,['scripts/preview-assembly.mjs',output],{stdio:'pipe'});const html=readFileSync(output,'utf8');
 for(const value of ['Synthetic local preview','Controls are inactive','browser layout and interactions have not been verified','Manufactured parts','Purchased components','Assembly tasks &amp; blockers','Fit checks &amp; test results','Freeze the facts for discussion','Snapshot ID: 30000000-0000-0000-0000-000000000700','Older part revision','Support bracket fit','Resolve bracket binding'])expect(html).toContain(value);
 expect(html).not.toContain('<script');expect(html).not.toContain('Bearer');expect(html).not.toContain('synthetic-assembly-actor-token');expect(html).not.toContain('@import');expect(html.match(/<main\b/g)).toHaveLength(1);
 }finally{rmSync(temp,{recursive:true,force:true});}
});
