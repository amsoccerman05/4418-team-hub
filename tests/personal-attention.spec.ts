import {test,expect} from '@playwright/test';
import {buildSync} from 'esbuild';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
let dir='',api:any;
const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const task=(n:number,p={})=>({id:id(n),board_id:id(10),title:`Task ${n}`,owner_ids:[id(1)],status:'todo',priority:'normal',due_date:null,...p});
function context(){return {user_id:id(1),season_id:id(20),seasons:[{id:id(20),status:'active'}],boards:[{id:id(10),name:'Robot',season_id:id(20),active:true,kind:'project'},{id:id(11),name:'Team operations',active:true,kind:'area'}],tasks:[] as any[]};}
function repair(n:number,p={}){return {id:id(n),issue_number:n,title:`Repair ${n}`,assigned_to:id(1),status:'OPEN',severity:'MEDIUM',...p};}
test.beforeAll(()=>{
 dir=mkdtempSync(join(tmpdir(),'personal-attention-'));
 const bundle=join(dir,'render.cjs');
 buildSync({stdin:{contents:`export * from './src/dashboard/personal-attention';export * from './src/planning/personal-task-route';export * from './src/planning/editor-session';export {PersonalAttentionPanel} from './src/dashboard/PersonalAttention';export {createElement} from 'react';export {renderToStaticMarkup} from 'react-dom/server';export {createClient} from '@supabase/supabase-js';`,resolveDir:resolve('.')},bundle:true,platform:'node',format:'cjs',jsx:'automatic',define:{'import.meta.env':'{}'},outfile:bundle,logLevel:'silent'});
 api=createRequire(import.meta.url)(bundle);
});
test.afterAll(()=>rmSync(dir,{recursive:true,force:true}));
test('Planning combines co-owned assignments once, filters other/done/archived work, and prioritizes blocked and overdue',()=>{
 const c=context();c.boards.push({id:id(12),name:'Old',season_id:id(20),kind:'project',active:false});
 c.tasks=[task(30),task(31,{status:'done'}),task(32,{owner_ids:[id(2)]}),task(33,{board_id:id(12)}),task(34,{owner_ids:[id(1),id(2)],status:'blocked',due_date:'2020-01-01'}),task(34,{owner_ids:[id(1),id(2)],status:'blocked',due_date:'2020-01-01'}),task(35,{due_date:'2026-10-05'}),task(36,{due_date:'2026-10-04'}),task(37,{status:'backlog'})];
 const list=api.planningAssignments(c,id(1),'2026-10-05');expect(list.total).toBe(5);expect(list.items.map((t:any)=>t.id)).toEqual([id(34),id(36),id(35)]);expect(list.items[0].href).toBe(`#planning/my-work/${id(34)}`);expect(list.items[0].detail).toContain('Blocked · Overdue');
});
test('Planning fails closed on actor mismatch and omits drafts/archived projects but retains functional boards',()=>{
 const c=context();c.tasks=[task(30),task(31,{board_id:id(11)})];
 expect(()=>api.planningAssignments(c,id(2))).toThrow(/unavailable/);
 for(const status of ['archived','draft']){c.seasons[0].status=status;expect(api.planningAssignments(c,id(1)).items.map((t:any)=>t.id)).toEqual([id(31)]);}
});
test('repair preview preserves exact count, deferred work, literal title text, and strict destination',()=>{
 const r=api.repairAssignments([repair(40,{severity:'ROBOT DOWN',status:'DEFERRED',title:'<script>alert(1)</script>'}),repair(41)],9,id(1));
 expect(r.total).toBe(9);expect(r.items).toHaveLength(2);expect(r.items[0].urgent).toBe(true);expect(r.items[0].detail).toBe('deferred · robot down');expect(r.items[0].href).toBe(`https://pit.frc4418.org/#issue/${id(40)}`);
 for(const [rows,count] of [[[repair(40,{assigned_to:id(2)})],1],[[repair(40,{status:'RESOLVED'})],1],[[repair(40,{id:'javascript:alert(1)'})],1],[[],null],[[],NaN],[[repair(40)],0]])expect(()=>api.repairAssignments(rows,count,id(1))).toThrow(/unavailable/);
});
test('read clients use existing actor RPC and a minimal owner-filtered counted Pit query only',async()=>{
 const requests:{url:URL;body:any;method:string}[]=[];
 const c=context();c.tasks=[task(30)];
 const client=api.createClient('https://personal-attention.invalid','local-test-public-key',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(input:any,init:any)=>{
  const url=new URL(input);requests.push({url,body:init.body?JSON.parse(init.body):null,method:init.method});
  return new Response(JSON.stringify(url.pathname.endsWith('planning_my_work_context')?c:[repair(40)]),{status:200,headers:{'content-type':'application/json','content-range':'0-0/8'}});
 }}});
 const signal=new AbortController().signal;
 expect((await api.fetchPlanningAssignments(id(1),signal,client)).total).toBe(1);
 expect((await api.fetchRepairAssignments(id(1),signal,client)).total).toBe(8);
 expect(requests).toHaveLength(2);expect(requests[0].body).toEqual({selected_season:null});expect(requests[0].url.pathname).toBe('/rest/v1/rpc/planning_my_work_context');
 const q=requests[1].url.searchParams;expect(requests[1].method).toBe('GET');expect(q.get('assigned_to')).toBe(`eq.${id(1)}`);expect(q.get('status')).toBe('in.(OPEN,DIAGNOSING,REPAIRING,TESTING,DEFERRED)');expect(q.get('select')).toBe('id,issue_number,title,status,severity,assigned_to');expect(q.get('limit')).toBe('3');expect(q.get('order')).toBe('updated_at.desc,id.asc');
});
test('query failures, missing count, mismatched actor, and aborted requests do not become empty results',async()=>{
 for(const body of [{status:403,data:{message:'Permission denied'}},{status:200,data:context()},{status:200,data:[]}]){
  const client=api.createClient('https://personal-attention.invalid','local-test-public-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async()=>new Response(JSON.stringify(body.data),{status:body.status,headers:{'content-type':'application/json'}})}});
  await expect(api.fetchRepairAssignments(id(1),new AbortController().signal,client)).rejects.toBeTruthy();
  if(body.status===403)await expect(api.fetchPlanningAssignments(id(1),new AbortController().signal,client)).rejects.toBeTruthy();
 }
 const client=api.createClient('https://personal-attention.invalid','local-test-public-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(_input:any,init:any)=>{init.signal.throwIfAborted();throw new Error('Unexpected live fetch');}}});
 const abort=new AbortController();abort.abort();await expect(api.fetchRepairAssignments(id(1),abort.signal,client)).rejects.toBeTruthy();
});
test('personal task route opens only assigned visible work, including completed tasks; malformed routes never resolve',()=>{
 const c=context();c.tasks=[task(30)];const route=`#planning/my-work/${id(30)}`;
 expect(api.personalTaskFromRoute(route,c)?.id).toBe(id(30));c.tasks[0].status='done';expect(api.personalTaskFromRoute(route,c)?.id).toBe(id(30));
 for(const bad of [route+'/extra','#planning/my-work/javascript:alert(1)','#planning/boards/'+id(30)])expect(api.personalTaskFromRoute(bad,c)).toBeNull();
 c.tasks[0].owner_ids=[id(2)];expect(api.personalTaskFromRoute(route,c)).toBeNull();c.tasks[0].owner_ids=[id(1)];c.boards[0].active=false;expect(api.personalTaskFromRoute(route,c)).toBeNull();
});
const ready=(data:any)=>({status:'ready',data});
function render(assignments:any,actions:any[]=[]){return api.renderToStaticMarkup(api.createElement(api.PersonalAttentionPanel,{assignments,actions}));}
test('SSR keeps existing actions and personal sources in one attention panel with honest truncated counts',()=>{
 const c=context();c.tasks=[task(30),task(31),task(32),task(33)];
 const html=render({planning:ready(api.planningAssignments(c,id(1))),pit:ready(api.repairAssignments([repair(40,{title:'<script>literal</script>'})],5,id(1)))},[{href:'#attendance/notices',text:'2 attendance requests to review'}]);
 expect((html.match(/Needs your attention/g)||[])).toHaveLength(1);expect(html).toContain('2 attendance requests to review');expect(html).toContain('4 open');expect(html).toContain('Showing 3 of 4');expect(html).toContain('Most recently updated: 1 of 5');expect(html).toContain('&lt;script&gt;literal&lt;/script&gt;');expect(html).not.toContain('<script>');expect(html).toContain(`href="https://pit.frc4418.org/#issue/${id(40)}"`);
});
test('SSR leaves empty queue quiet but distinguishes loading and partial source failure',()=>{
 expect(render({planning:api.emptyAssignments(),pit:api.emptyAssignments()})).toBe('');
 expect(render(api.loadingAssignments())).toContain('Checking your planning tasks');
 const c=context();c.tasks=[task(30)];const html=render({planning:ready(api.planningAssignments(c,id(1))),pit:{...api.emptyAssignments(),status:'error'}});
 expect(html).toContain('Task 30');expect(html).toContain('couldn’t be checked');expect(html).not.toContain('caught up');
});

test('editor completion ignores Back, a newer task, and a reopened copy of the same task',()=>{
 const edit={entity:'task',p:{id:id(30)}};const original={route:`#planning/my-work/${id(30)}`,edit};
 expect(api.isCurrentEditor(original,original,original.route)).toBe(true);
 expect(api.isCurrentEditor(original,original,original.route,false)).toBe(false);
 expect(api.isCurrentEditor(original,original,'#planning/my-work')).toBe(false);
 expect(api.isCurrentEditor(original,{route:'#planning/my-work',edit:null},'#planning/my-work')).toBe(false);
 const next={route:`#planning/my-work/${id(31)}`,edit:{entity:'task',p:{id:id(31)}}};
 expect(api.isCurrentEditor(original,next,next.route)).toBe(false);
 expect(api.isCurrentEditor(original,{route:original.route,edit:{...edit}},original.route)).toBe(false);
});

test('personal task UUID normalization preserves the exact route grammar',()=>{
 const c=context();const taskId='abcdef01-2345-4abc-8def-abcd12345678';c.tasks=[task(30,{id:taskId})];
 expect(api.personalTaskFromRoute(`#planning/my-work/${taskId.toUpperCase()}`,c)?.id).toBe(taskId);
 expect(api.personalTaskFromRoute(`#PLANNING/my-work/${taskId}`,c)).toBeNull();
 expect(api.personalTaskFromRoute(`#planning/MY-WORK/${taskId}`,c)).toBeNull();
});
