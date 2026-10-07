import {test,expect} from '@playwright/test';
import {buildSync} from 'esbuild';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {sprintReviewUIFixture,uiActor} from './fixtures/sprint-review-ui';

let dir='',api:any;
test.beforeAll(()=>{
 dir=mkdtempSync(join(tmpdir(),'design-decision-controls-'));const file=join(dir,'controls.cjs');
 buildSync({stdin:{contents:`export * from './src/planning/reviews/decision-model';export * from './src/planning/reviews/DecisionEditor';export {UpdateDialog} from './src/planning/reviews/ReviewDialogs';export {createElement} from 'react';export {renderToStaticMarkup} from 'react-dom/server';`,resolveDir:resolve('.')},bundle:true,platform:'node',format:'cjs',jsx:'automatic',loader:{'.css':'empty'},define:{'import.meta.env':'{}'},outfile:file,logLevel:'silent'});api=createRequire(import.meta.url)(file);
});
test.afterAll(()=>rmSync(dir,{recursive:true,force:true}));
const render=(component:any,props:any)=>api.renderToStaticMarkup(api.createElement(component,props));

function expectSelectLabel(html:string,label:string){
 // Inspect the actual rendered association: the label must end before select
 // options, so exact-label queries and assistive naming cannot include them.
 const association=html.match(new RegExp(`<label for="([^"]+)">${label}</label><select id="\\1"`));
 expect(association,`A separate label must name the ${label} select`).not.toBeNull();
}

test('rendered decision selects have stable explicit labels independent of option contents',()=>{
 const context=sprintReviewUIFixture(),workflow=api.blankDecisionWorkflow();workflow.owner_id=uiActor;workflow.options[0].label='Compact layout';workflow.options[1].label='Accessible layout';workflow.chosen_option_id=workflow.options[1].id;
 const owner=render(api.DecisionEditor,{workflow,people:context.members,onChange:()=>{}});expectSelectLabel(owner,'Decision owner');expect(owner).toContain('Alex Student');
 for(const status of ['comparing','recorded','reopened']){
  const html=render(api.DecisionRecordFields,{workflow:{...workflow,status},onChange:()=>{}});expectSelectLabel(html,'Decision status');expectSelectLabel(html,status==='reopened'?'Previous chosen option':'Chosen option');expect(html).toContain('selected="">Accessible layout</option>');
 }
});

test('weekly update keeps disabled form controls inside the scroll div and its actions outside',()=>{
 const data=sprintReviewUIFixture(),previousLocation=Object.getOwnPropertyDescriptor(globalThis,'location');
 Object.defineProperty(globalThis,'location',{value:{hash:'#planning/reviews'},configurable:true});
 try{for(const busy of [false,true]){
  const html=render(api.UpdateDialog,{board:data.boards[1],review:data.reviews[0],data,prior:data.previous_updates[0],busy,error:'',onClose:()=>{},onSave:()=>{}});
  expect(html).toContain(`<div class="sr-update-scroll"><fieldset class="sr-fields"${busy?' disabled=""':''}>`);
  expect(html).toContain('</fieldset></div><div class="sr-dialog-footer">');
  const footer=html.slice(html.indexOf('<div class="sr-dialog-footer">'));
  expect(footer).toContain('<button type="button">Close</button>');expect(footer).toContain(busy?'disabled="">Saving…':'Save weekly update');
  expect(html).toContain('Add evidence link');expect(html).toContain('Carry forward open items');
 }}finally{if(previousLocation)Object.defineProperty(globalThis,'location',previousLocation);else Reflect.deleteProperty(globalThis,'location');}
});
