import {test,expect} from '@playwright/test';
import {build} from 'esbuild';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
let dir='',Editor:any;
test.beforeAll(async()=>{
 dir=mkdtempSync(join(tmpdir(),'planning-editor-'));const file=join(dir,'editor.cjs');
 await build({entryPoints:[resolve('src/planning/Editor.tsx')],bundle:true,platform:'node',format:'cjs',jsx:'automatic',outfile:file,logLevel:'silent',plugins:[{name:'synthetic-editor-services',setup(b){
  b.onResolve({filter:/^(react|react\/jsx-runtime)$/},a=>({path:a.path,namespace:'synthetic'}));
  b.onResolve({filter:/^\.\/(service|Owners|TaskDependencies)$/},a=>a.importer.includes('/planning/')?{path:a.path,namespace:'synthetic'}:null);
  b.onLoad({filter:/.*/,namespace:'synthetic'},a=>({contents:a.path==='react'?`export const useState=(...a)=>globalThis.__planningEditor.useState(...a),useRef=(...a)=>globalThis.__planningEditor.useRef(...a),useEffect=()=>{};`:a.path==='react/jsx-runtime'?`export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment='fragment';`:a.path==='./service'?`export const savePlanning=(...a)=>globalThis.__planningEditor.save(...a),loadPlanning=(...a)=>globalThis.__planningEditor.load(...a),taskDetail=async()=>({steps:[],comments:[],history:[]}),taskStatuses={},planStatuses={},priorities={};`:`export const OwnerPicker=()=>null,OwnerSummary=()=>null,TaskDependencies=()=>null;`,loader:'js'}));
 }}]});Editor=createRequire(import.meta.url)(file).Editor;
});
test.afterAll(()=>{rmSync(dir,{recursive:true,force:true});delete (globalThis as any).__planningEditor;delete (globalThis as any).document;});
const task={id:'task',board_id:'board',title:'Original',description:'Original notes',status:'todo',priority:'normal',owner_ids:['member'],owners:[{id:'member',name:'Member'}],version:1};
function harness(save:(...args:any[])=>Promise<any>,load=async()=>({user_id:'member',can_write:true,tasks:[task]})){
 const slots:any[]=[];let cursor=0,closed=0,saved=0;
 (globalThis as any).document={activeElement:{focus(){}}};
 (globalThis as any).__planningEditor={save,load,useState:(initial:any)=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],(v:any)=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},useRef:(initial:any)=>{const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];}};
 const props:any={edit:{entity:'task',p:{...task}},data:{user_id:'member',can_manage:true,can_write:true,season_id:'season',seasons:[{id:'season',status:'active'}],boards:[{id:'board',kind:'project',active:true}],members:[],areas:[],tasks:[task]},onSaved:async()=>{saved++;},onClose:()=>{closed++;}};
 return {props,render:()=>{cursor=0;return Editor(props);},counts:()=>({closed,saved})};
}
function nodes(n:any):any[]{if(Array.isArray(n))return n.flatMap(nodes);if(!n||typeof n!=='object')return [];return [n,...nodes(n.props?.children)];}
const mainForm=(tree:any)=>nodes(tree).find(n=>n.type==='form');
const titleInput=(tree:any)=>nodes(tree).find(n=>n.type==='input'&&n.props.required);
const button=(tree:any,text:string)=>nodes(tree).find(n=>n.type==='button'&&n.props.children===text);
const submit=(tree:any)=>mainForm(tree).props.onSubmit({preventDefault(){}});
const settle=()=>new Promise<void>(r=>setImmediate(r));
test('actual editor preserves draft after ordinary failure, never reloads it, and gates repeated saves',async()=>{
 const calls:any[]=[];let fail=true,reads=0;const h=harness(async(...a)=>{calls.push(a);if(fail)throw Error('Temporary interruption');},async()=>{reads++;return {user_id:'member',can_write:true,tasks:[task]};});
 titleInput(h.render()).props.onChange({target:{value:'Typed work'}});const form=h.render();submit(form);submit(form);await settle();
 expect(calls).toHaveLength(1);expect(reads).toBe(0);expect(titleInput(h.render()).props.value).toBe('Typed work');expect(h.counts()).toEqual({closed:0,saved:0});
 fail=false;submit(h.render());await settle();expect(calls[1][1]).toMatchObject({title:'Typed work',version:1});expect(h.counts()).toEqual({closed:1,saved:1});
});
test('actual editor requires explicit review and choices before refreshing its stale token',async()=>{
 const calls:any[]=[];let failRead=true;const latest={...task,title:'Their title',status:'done',version:2};
 const h=harness(async(...a)=>{calls.push(a);if(calls.length===1)throw Error('Changed by another teammate. Refresh before saving.');},async()=>{if(failRead)throw Error('Refresh unavailable');return {user_id:'member',can_write:true,tasks:[latest]};});
 titleInput(h.render()).props.onChange({target:{value:'My title'}});submit(h.render());await settle();expect(titleInput(h.render()).props.value).toBe('My title');expect(button(h.render(),'Save').props.disabled).toBe(true);
 submit(h.render());await settle();expect(calls).toHaveLength(1);button(h.render(),'Review latest task').props.onClick();await settle();expect(titleInput(h.render()).props.value).toBe('My title');
 failRead=false;button(h.render(),'Review latest task').props.onClick();await settle();let review=nodes(h.render()).find(n=>n.type?.name==='TaskConflictReview');expect(review.props.latest.version).toBe(2);expect(titleInput(h.render()).props.value).toBe('My title');
 review.props.onChoice('title','draft');review=nodes(h.render()).find(n=>n.type?.name==='TaskConflictReview');review.props.onApply();expect(calls).toHaveLength(1);submit(h.render());await settle();expect(calls[1][1]).toMatchObject({title:'My title',status:'done',version:2});expect(h.counts()).toEqual({closed:1,saved:1});
});
test('actual open draft survives Readonly, missing access and restoration without outgoing writes or autosave',async()=>{
 const calls:any[]=[];const h=harness(async(...args)=>calls.push(args));
 titleInput(h.render()).props.onChange({target:{value:'Preserve my work'}});
 for(const flag of [false,undefined]){
  h.props.data={...h.props.data,can_write:flag};
  expect(nodes(h.render()).find(n=>n.type==='fieldset').props.disabled).toBe(true);
  submit(h.render());await settle();expect(calls).toHaveLength(0);
  expect(titleInput(h.render()).props.value).toBe('Preserve my work');
 }
 h.props.data={...h.props.data,can_write:true};h.render();await settle();expect(calls).toHaveLength(0);
 submit(h.render());await settle();expect(calls[0][1].title).toBe('Preserve my work');
});
test('actual permission-denied save rechecks access, survives failed recheck and restores only after explicit refresh',async()=>{
 const calls:any[]=[];let refreshed=0,allow=false;
 const h=harness(async(...args)=>{calls.push(args);if(!allow)throw Object.assign(Error('Role changed'),{code:'42501'});});
 h.props.onRefreshAccess=async()=>{refreshed++;if(!allow){h.props.data={...h.props.data,can_write:undefined};return false;}h.props.data={...h.props.data,can_write:true};return true;};
 titleInput(h.render()).props.onChange({target:{value:'Interrupted draft'}});submit(h.render());await settle();
 expect(refreshed).toBe(1);expect(titleInput(h.render()).props.value).toBe('Interrupted draft');
 submit(h.render());await settle();expect(calls).toHaveLength(1);
 allow=true;button(h.render(),'Refresh editing access').props.onClick();await settle();expect(calls).toHaveLength(1);
 expect(titleInput(h.render()).props.value).toBe('Interrupted draft');submit(h.render());await settle();expect(calls).toHaveLength(2);
});
test('current ownership overrides retained draft owners without losing typed text',async()=>{
 const calls:any[]=[];const h=harness(async(...args)=>calls.push(args));
 h.props.data.can_manage=false;titleInput(h.render()).props.onChange({target:{value:'Old owner draft'}});
 h.props.data.tasks=[{...task,owner_ids:[]}];submit(h.render());await settle();expect(calls).toHaveLength(0);
 expect(titleInput(h.render()).props.value).toBe('Old owner draft');
});
