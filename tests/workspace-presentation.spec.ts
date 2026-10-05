import {test, expect} from '@playwright/test';
import {buildSync} from 'esbuild';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createRequire} from 'node:module';
// Playwright replaces TSX imports with browser component stubs. Bundle this small
// server-render target with the actual React JSX runtime for browser-free checks.
let renderDir='';
let createElement:any,renderToStaticMarkup:any,PlanningDashboard:any,BoardSummary:any,LeadershipDashboard:any;
test.beforeAll(()=>{
 renderDir=mkdtempSync(join(tmpdir(),'workspace-presentation-'));
 const renderBundle=join(renderDir,'render.cjs');
 buildSync({stdin:{contents:`
  export {createElement} from 'react';
  export {renderToStaticMarkup} from 'react-dom/server';
  export {PlanningDashboard} from './src/planning/PlanningDashboard';
  export {BoardSummary} from './src/planning/BoardSummary';
  export {LeadershipDashboard} from './src/attendance/PolicyDashboard';
 `,resolveDir:resolve('.')},bundle:true,platform:'node',format:'cjs',jsx:'automatic',define:{'import.meta.env':'{}'},outfile:renderBundle,logLevel:'silent'});
 ({createElement,renderToStaticMarkup,PlanningDashboard,BoardSummary,LeadershipDashboard}=createRequire(import.meta.url)(renderBundle));
});
test.afterAll(()=>{if(renderDir)rmSync(renderDir,{recursive:true,force:true});});
import type {Context, Task} from '../src/planning/service';
import type {Data} from '../src/attendance/service';

function planningFixture(): Context {
 const season={id:'season',name:'Fixture season',start_date:null,end_date:null,status:'active' as const,version:1};
 return {user_id:'member',can_manage:true,season_id:season.id,seasons:[season],members:[],areas:[],groups:[],items:[],boards:[
  {id:'board',name:'Build team',description:'A safe fixture project',season_id:season.id,kind:'project',area_id:null,active:true,display_order:0,version:1},
  {id:'archived',name:'Archived project',description:'',season_id:season.id,kind:'project',area_id:null,active:false,display_order:1,version:1},
 ],tasks:[]};
}
function task(id:string,status:string,extra:Partial<Task>={}):Task {
 return {id,title:id,board_id:'board',description:'',status,priority:'normal',owner_ids:['member'],owners:[{id:'member',name:'Fixture member'}],area_id:null,start_date:null,due_date:null,blocked_reason:'',version:1,...extra};
}
function renderPlanning(data:Context){return renderToStaticMarkup(createElement(PlanningDashboard,{data,season:data.seasons[0],onTask:()=>{},onBoard:()=>{}}));}

test('Planning presentation includes Backlog and counts each active task once',()=>{
 const data=planningFixture();data.tasks=[task('Backlog task','backlog'),task('Open task','todo',{owner_ids:['member','teammate']}),task('Done task','done'),task('Archived blocked task','blocked',{board_id:'archived'})];
 const html=renderPlanning(data);
 expect(html).toMatch(/data-status="backlog"[^]*?<dd>1<\/dd>/);
 expect(html).toMatch(/data-status="todo"[^]*?<dd>1<\/dd>/);
 expect(html).toMatch(/data-status="done"[^]*?<dd>1<\/dd>/);
 expect(html).toContain('1 of 3 complete');expect(html).toContain('2 open');
 expect(html).not.toContain('Archived blocked task');expect(html).not.toContain('Archived project');
 expect(html).toContain('No overdue or blocked tasks');
});

test('Planning attention deduplicates overdue blocked tasks and retains empty summaries',()=>{
 const data=planningFixture();data.tasks=[task('Overdue blocked','blocked',{due_date:'2000-01-01'}),task('Overdue task','todo',{due_date:'2000-01-02'})];
 const html=renderPlanning(data);
 expect(html).toContain('2 overdue · 1 blocked');
 expect((html.match(/>Overdue blocked<\/button>/g)||[]).length).toBe(1);
 expect(html).toContain('No upcoming milestones.');
 data.tasks=[];const empty=renderPlanning(data);
 expect(empty).toContain('0 of 0 complete');expect(empty).toContain('No tasks yet.');expect(empty).toContain('Your open assignments will appear here.');
});

test('Board card retains its accessible name and exposes accurate completion',()=>{
 const data=planningFixture();const html=renderToStaticMarkup(createElement(BoardSummary,{board:data.boards[0],tasks:[task('Done','done'),task('Blocked','blocked')],onOpen:()=>{}}));
 expect(html).toContain('aria-label="Build team"');expect(html).toContain('1 / 2 tasks complete');expect(html).toContain('1 blocked');expect(html).toContain('aria-label="Build team tasks complete" value="1" max="2"');
});

test('Attendance presentation separates empty review queue from member follow-ups',()=>{
 const data:Data={members:[{student_id:'student',display_name:'Fixture member',member_status:'registered',team_area:'Build'}],meetings:[],attendance:[],snapshots:[],history:[],strikes:[],policy:{user_id:'mentor',can_review:true,can_read_team:true,can_manage_meetings:true,strike_year_start:'2026-01-01T00:00:00Z',people:[],warnings:[]}};
 const render=()=>renderToStaticMarkup(createElement(LeadershipDashboard,{data,run:async()=>{},openMeeting:()=>{}}));
 expect(render()).toContain('No attendance actions need attention.');
 data.strikes.push({id:'strike',attendance_id:'record',meeting_id:'meeting',student_id:'student',category:'Other',quantity:2,explanation:'Fixture reason',assigned_by:'mentor',assigned_at:'2026-06-01T00:00:00Z',rescinded_at:null,rescind_reason:null});
 const html=render();expect(html).toContain('Meeting reviews are up to date');expect(html).toContain('Fixture member · 2 strikes');expect(html).toContain('Member follow-ups');expect(html).not.toContain('No attendance actions need attention.');
});
