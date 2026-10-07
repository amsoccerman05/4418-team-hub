// Local synthetic interactive preview of the actual Attendance components.
// Never included in production. No live service, real records, or messages.
import { buildSync } from 'esbuild';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
const root=process.cwd(),out=resolve(process.argv[2]||'test-results/attendance-preview.html');
const entry=`import React,{useEffect,useState} from 'react';import{createRoot}from'react-dom/client';import{AttendanceHub}from ${JSON.stringify(resolve('src/attendance/Attendance.tsx'))};function Preview(){const[tab,setTab]=useState(location.hash.split('/')[1]||'calendar');useEffect(()=>{const change=()=>setTab(location.hash.split('/')[1]||'calendar');addEventListener('hashchange',change);return()=>removeEventListener('hashchange',change);},[]);return <main style={{maxWidth:1200,margin:'auto',padding:24}}><AttendanceHub workspace tab={tab}/></main>};createRoot(document.getElementById('app')).render(<Preview/>);`;
const js=buildSync({stdin:{contents:entry,loader:'tsx',resolveDir:root},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',loader:{'.css':'empty'},define:{'import.meta.env':JSON.stringify({VITE_SUPABASE_URL:'https://attendance-test.supabase.invalid',VITE_SUPABASE_ANON_KEY:'test-public-key'}),'process.env.NODE_ENV':'"development"'},logLevel:'silent'}).outputFiles[0].text;
const setup=`
const isStudent=new URLSearchParams(location.search).get('role')==='student';
const id='00000000-0000-0000-0000-000000000003';
const user={id,email:'synthetic@test.invalid',app_metadata:{},user_metadata:{},aud:'authenticated',created_at:'2026-01-01T00:00:00Z'};
localStorage.setItem('4418-team-hub-auth',JSON.stringify({access_token:'test-token',refresh_token:'test-refresh',expires_at:4000000000,token_type:'bearer',user}));
const future=hours=>new Date(Date.now()+hours*3600000).toISOString();
const meeting={id:'m1',title:'Synthetic upcoming build',meeting_type:'preseason',starts_at:future(2),ends_at:future(5),late_minutes:5,requirement:'active',status:'draft',check_in_open:false,code_expires_at:null,version:1};
const attendance={id:'a1',meeting_id:'m1',student_id:id,physical_status:'pending',review_status:'pending',checked_in_at:null,left_at:null,notice_at:new Date().toISOString(),notice_reason:'Synthetic scheduling example',notice_type:'late',expected_at:future(3),review_reason:'',reviewed_at:null,reviewed_by:null,version:1};
let failNextRead=false,calls=0;document.getElementById('fail-refresh').onclick=()=>{failNextRead=true;document.getElementById('test-state').textContent='The next post-save refresh will fail once.'};
window.fetch=async(input,init)=>{const url=new URL(typeof input==='string'?input:input.url);if(url.hostname!=='attendance-test.supabase.invalid')throw Error('Synthetic preview has no external network');let result=[];const path=url.pathname;const body=init?.body?JSON.parse(init.body):{};
if(path.endsWith('/profiles'))result={id,display_name:'Synthetic '+(isStudent?'Student':'Lead'),role:isStudent?'student':'lead',active:true};
else if(path.endsWith('/team_attendance_policy_context'))result={user_id:id,can_review:false,can_read_team:!isStudent,can_manage_meetings:!isStudent,strike_year_start:null,people:[],warnings:[]};
else if(path.endsWith('/team_meetings')){if(failNextRead&&calls>0){failNextRead=false;return new Response(JSON.stringify({message:'Synthetic refresh failure'}),{status:500,headers:{'Content-Type':'application/json'}});}result=[meeting];}
else if(path.endsWith('/team_attendance'))result=[attendance];
else if(path.endsWith('/team_meeting_members'))result=[{meeting_id:'m1',student_id:id,required:true,member_status:'registered',team_area:'Build'}];
else if(path.endsWith('/team_attendance_roster'))result=[{student_id:id,display_name:'Synthetic Student',member_status:'registered',team_area:'Build'}];
else if(path.endsWith('/team_attendance_strikes')||path.endsWith('/team_attendance_history'))result=[];
else if(path.endsWith('/team_attendance_edit_meeting')){calls++;const p=body.p;if(isStudent)throw Error('Synthetic unauthorized');const changed=p.starts_at!==meeting.starts_at||p.ends_at!==meeting.ends_at;Object.assign(meeting,{title:p.title,meeting_type:p.meeting_type,starts_at:p.starts_at,ends_at:p.ends_at,version:meeting.version+1});if(changed){meeting.check_in_open=false;meeting.code_expires_at=null;}result={id:'m1',version:meeting.version,changed:true};document.getElementById('test-state').textContent=calls+' synthetic save call(s).';}
else throw Error('Unexpected synthetic request: '+path);
return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});
};`;
const css=['src/tokens.css','src/style.css','src/design-system.css','src/attendance/attendance.css'].map(p=>readFileSync(p,'utf8')).join('\n').replace(/@import[^;]+;/g,'');
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>Attendance · Synthetic local preview</title><style>${css}body{margin:0}.preview-banner{background:#224d3e;color:white;padding:12px 24px;font:14px/1.6 system-ui}.preview-banner a{color:white;margin-right:18px}.preview-banner button{margin:8px;padding:8px}main{display:block!important}.attendance-section{margin-top:0}#test-state{margin-left:10px}</style></head><body><header class="preview-banner"><strong>Synthetic local preview. No live account, records, or messages.</strong><br><a href="?role=lead#attendance/calendar">Lead preview</a><a href="?role=student#attendance/calendar">Student preview</a><button id="fail-refresh">Simulate refresh failure</button><span id="test-state">No saves.</span></header><div id="app"></div><script>${setup.replaceAll('</script','<\\/script')}</script><script>${js.replaceAll('</script','<\\/script')}</script></body></html>`;
mkdirSync(dirname(out),{recursive:true});writeFileSync(out,html);console.log('Wrote '+out);
