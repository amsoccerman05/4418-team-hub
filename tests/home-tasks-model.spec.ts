import {test,expect} from '@playwright/test';
import {buildSync} from 'esbuild';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
let dir='',api:any;
test.beforeAll(()=>{
 dir=mkdtempSync(join(tmpdir(),'home-tasks-'));
 const bundle=join(dir,'render.cjs');
 buildSync({stdin:{contents:`export * from './src/dashboard/purchase-next-step';export * from './src/planning/personal-task-route';export {HomeTasks} from './src/dashboard/HomeTasks';export {homeTasks} from './src/links';export {createElement} from 'react';export {renderToStaticMarkup} from 'react-dom/server';`,resolveDir:resolve('.')},bundle:true,platform:'node',format:'cjs',jsx:'automatic',outfile:bundle,logLevel:'silent'});
 api=createRequire(import.meta.url)(bundle);
});
test.afterAll(()=>rmSync(dir,{recursive:true,force:true}));
test('task links use confirmed destination contracts and accessible actions without changing suite link behavior',()=>{
 expect(api.homeTasks.map((t:any)=>[t.name,t.url])).toEqual([
  ['Find a part','https://inventory.frc4418.org/#inventory'],
  ['Request a purchase','https://finance.frc4418.org/?action=request-purchase'],
  ['Report a problem','https://pit.frc4418.org/'],
  ['My assignments','#planning/my-work'],
 ]);
 const html=api.renderToStaticMarkup(api.createElement(api.HomeTasks));
 expect((html.match(/<nav/g)||[])).toHaveLength(1);expect((html.match(/<a /g)||[])).toHaveLength(4);
 expect(html).toContain('aria-label="Start a task"');expect(html).toContain('Open Pit, then choose Report issue.');expect(html).toContain('Open your assigned Planning tasks.');expect(html).not.toContain('target=');
 for(const task of api.homeTasks){expect(html).toContain(`aria-labelledby="task-${task.id}"`);expect(html).toContain(`aria-describedby="task-${task.id}-description"`);}
});
test('purchase summaries distinguish action, waiting, completed, and unknown states without guessing a reviewer',()=>{
 expect(api.purchaseNextStep('draft',0)).toMatch(/Complete.*submit/);
 expect(api.purchaseNextStep('changes_requested',0)).toMatch(/requested changes.*resubmit/);
 expect(api.purchaseNextStep('awaiting_approval',0)).toContain('Lead Coach and Finance Lead');
 expect(api.purchaseNextStep('awaiting_approval',1)).toBe('Waiting for the remaining approver. Nothing to do right now.');
 for(const count of [2,3,-1,NaN])expect(api.purchaseNextStep('awaiting_approval',count)).toContain('check the latest approval status');
 expect(api.purchaseNextStep('approved',2)).toContain('school submission');
 expect(api.purchaseNextStep('submitted_to_school',2)).toContain('full order arrives');
 for(const status of ['received','cancelled'])expect(api.purchaseNextStep(status,0)).toContain('no further action');
 expect(api.purchaseNextStep('new_unrecognized_status',0)).toContain('check the current status');
});
test('assignment list and exact task routes survive sign-in while malformed or unrelated routes do not',()=>{
 const uuid='abcdef01-2345-4abc-8def-abcd12345678';
 for(const route of ['#planning/my-work',`#planning/my-work/${uuid}`,`#planning/my-work/${uuid.toUpperCase()}`])expect(api.isPersonalWorkRoute(route)).toBe(true);
 for(const route of ['#planning/my-work/','#planning/my-work/javascript:alert(1)',`#planning/my-work/${uuid}/extra`,'#PLANNING/my-work','#planning/MY-WORK','#planning/my-work?admin=1','#planning/boards'])expect(api.isPersonalWorkRoute(route)).toBe(false);
 const auth=readFileSync('src/HubAuth.tsx','utf8');expect(auth).toContain('explicitSignOut.current||!(attendanceMeetingId(location.hash)||isPersonalWorkRoute(location.hash))');
 expect(auth).toContain('const target=(attendanceMeetingId(location.hash)||isPersonalWorkRoute(location.hash)||');
});
