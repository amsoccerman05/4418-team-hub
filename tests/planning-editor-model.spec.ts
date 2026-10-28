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
function harness(save:(...args:any[])=>Promise<any>,load=async()=>({user_id:'member',tasks:[task]})){
 const slots:any[]=[];let cursor=0,closed=0,saved=0;
 (globalThis as any).document={activeElement:{focus(){}}};
 (globalThis as any).__planningEditor={save,load,useState:(initial:any)=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],(v:any)=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},useRef:(initial:any)=>{const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];}};
 const props={edit:{entity:'task',p:{...task}},data:{user_id:'member',can_manage:true,season_id:'season',seasons:[{id:'season',status:'active'}],boards:[{id:'board',kind:'project',active:true}],members:[],areas:[],tasks:[task]},onSaved:async()=>{saved++;},onClose:()=>{closed++;}};
 return {render:()=>{cursor=0;return Editor(props);},counts:()=>({closed,saved})};
}
function nodes(n:any):any[]{if(Array.isArray(n))return n.flatMap(nodes);if(!n||typeof n!=='object')return [];return [n,...nodes(n.props?.children)];}
const mainForm=(tree:any)=>nodes(tree).find(n=>n.type==='form');
const titleInput=(tree:any)=>nodes(tree).find(n=>n.type==='input'&&n.props.required);
const button=(tree:any,text:string)=>nodes(tree).find(n=>n.type==='button'&&n.props.children===text);
const submit=(tree:any)=>mainForm(tree).props.onSubmit({preventDefault(){}});
const settle=()=>new Promise<void>(r=>setImmediate(r));
test('actual editor preserves draft after ordinary failure, never reloads it, and gates repeated saves',async()=>{
 const calls:any[]=[];let fail=true,reads=0;const h=harness(async(...a)=>{calls.push(a);if(fail)throw Error('Temporary interruption');},async()=>{reads++;return {user_id:'member',tasks:[task]};});
 titleInput(h.render()).props.onChange({target:{value:'Typed work'}});const form=h.render();submit(form);submit(form);await settle();
 expect(calls).toHaveLength(1);expect(reads).toBe(0);expect(titleInput(h.render()).props.value).toBe('Typed work');expect(h.counts()).toEqual({closed:0,saved:0});
 fail=false;submit(h.render());await settle();expect(calls[1][1]).toMatchObject({title:'Typed work',version:1});expect(h.counts()).toEqual({closed:1,saved:1});
});
test('actual editor requires explicit review and choices before refreshing its stale token',async()=>{
 const calls:any[]=[];let failRead=true;const latest={...task,title:'Their title',status:'done',version:2};
 const h=harness(async(...a)=>{calls.push(a);if(calls.length===1)throw Error('Changed by another teammate. Refresh before saving.');},async()=>{if(failRead)throw Error('Refresh unavailable');return {user_id:'member',tasks:[latest]};});
 titleInput(h.render()).props.onChange({target:{value:'My title'}});submit(h.render());await settle();expect(titleInput(h.render()).props.value).toBe('My title');expect(button(h.render(),'Save').props.disabled).toBe(true);
 submit(h.render());await settle();expect(calls).toHaveLength(1);button(h.render(),'Review latest task').props.onClick();await settle();expect(titleInput(h.render()).props.value).toBe('My title');
 failRead=false;button(h.render(),'Review latest task').props.onClick();await settle();let review=nodes(h.render()).find(n=>n.type?.name==='TaskConflictReview');expect(review.props.latest.version).toBe(2);expect(titleInput(h.render()).props.value).toBe('My title');
 review.props.onChoice('title','draft');review=nodes(h.render()).find(n=>n.type?.name==='TaskConflictReview');review.props.onApply();expect(calls).toHaveLength(1);submit(h.render());await settle();expect(calls[1][1]).toMatchObject({title:'My title',status:'done',version:2});expect(h.counts()).toEqual({closed:1,saved:1});
});
