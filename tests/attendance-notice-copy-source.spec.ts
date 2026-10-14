import {test,expect} from '@playwright/test';
import {readFileSync,readdirSync} from 'node:fs';

const directory='supabase/migrations';
const targets:Record<string,{predecessor:string;replacements:[string,string,number][]}>={
 'notifications_private.center_attendance':{
  predecessor:'20261008032108_attendance_program_manager_notification_routing.sql',
  replacements:[["'An attendance strike was recorded'","'An attendance notice was recorded'",1]]
 },
 'public.team_attendance_manage':{
  predecessor:'20261014052049_attendance_stem_outreach.sql',
  replacements:[
   ["'Automatic absence strike preview changed or is missing. Refresh and review before completing attendance'","'Automatic absence notice preview changed or is missing. Refresh and review before completing attendance'",2],
   ["'An automatic absence strike already exists. Review or rescind it before assigning a replacement'","'An automatic absence notice already exists. Review or rescind it before assigning a replacement'",1],
   ["'Active strike not found'","'Active attendance notice not found'",1]]
 },
 'team_attendance_private.edit_meeting':{
  predecessor:'20261014052049_attendance_stem_outreach.sql',
  replacements:[["'Recorded attendance, reviewed decisions, or strikes lock this participant’s requirement'","'Recorded attendance, reviewed decisions, or attendance notices lock this participant’s requirement'",1]]
 },
 'team_attendance_private.no_outreach_strikes':{
  predecessor:'20261014052049_attendance_stem_outreach.sql',
  replacements:[["'STEM outreach participation never receives attendance strikes'","'STEM outreach participation never receives attendance notices'",1]]
 },
 'team_attendance_private.reconcile_absence_strike':{
  predecessor:'20261009155227_attendance_automatic_absence_strikes.sql',
  replacements:[
   ["'Automatic absence strike rescinded after attendance or excuse correction.'","'Automatic absence notice rescinded after attendance or excuse correction.'",1],
   ["'Automatic strike for a required unexcused absence after attendance completion.'","'Automatic attendance notice for a required unexcused absence after attendance completion.'",1]]
 }
};

function migration(){
 const names=readdirSync(directory).filter(name=>name.endsWith('_attendance_notice_copy.sql'));
 expect(names).toHaveLength(1);
 return readFileSync(directory+'/'+names[0],'utf8');
}
function definition(sql:string,name:string){
 const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const regex=new RegExp('create(?:\\s+or\\s+replace)?\\s+function\\s+'+escaped+'\\s*\\([\\s\\S]*?\\bas\\s+(\\$[A-Za-z_0-9]*\\$)([\\s\\S]*?)\\1','i');
 const match=sql.match(regex);
 if(!match)throw new Error('Function definition missing: '+name);
 // pg_get_functiondef adds wrapper casing and dollar labels; do not normalize
 // any internal body whitespace, identifiers, conditions, or executable tokens.
 return {body:match[2].trim(),header:match[0].slice(0,match[0].indexOf(match[1])).trim()};
}
const normalizedHeader=(s:string)=>s.toLowerCase()
 .replace(/create\s+(?:or\s+replace\s+)?function/,'create or replace function')
 .replace(/set\s+search_path\s+(?:to\s+)?/,'set search_path=')
 .replace(/\s+/g,'').replace(/search_path==/,'search_path=');

test('attendance notice migration changes exactly nine approved prose literals',()=>{
 const proposed=migration();let occurrences=0;
 for(const [name,target] of Object.entries(targets)){
  const original=definition(readFileSync(directory+'/'+target.predecessor,'utf8'),name);
  const next=definition(proposed,name);
  let expected=original.body;
  for(const [before,after,count] of target.replacements){
   expect(expected.split(before).length-1,name+': original literal count').toBe(count);
   expected=expected.replaceAll(before,after);occurrences+=count;
  }
  expect(next.body,name+': exact body after only approved literal substitutions').toBe(expected);
  expect(normalizedHeader(next.header),name+': signature, return type, language, security and search path').toBe(normalizedHeader(original.header));
 }
 expect(occurrences).toBe(9);
});

test('attendance notice migration has only five replacements and a transaction wrapper',()=>{
 let sql=migration();
 const declarations=[...sql.matchAll(/create\s+or\s+replace\s+function\s+([a-z_]+\.[a-z_]+)\s*\(/gi)].map(m=>m[1]);
 expect(declarations.sort()).toEqual(Object.keys(targets).sort());
 // Remove complete function statements, then allow only comments and BEGIN/COMMIT.
 sql=sql.replace(/create\s+or\s+replace\s+function\s+[a-z_]+\.[a-z_]+\s*\([\s\S]*?\bas\s+(\$[A-Za-z_0-9]*\$)[\s\S]*?\1\s*;/gi,'');
 expect(sql.replace(/--[^\n]*/g,'').replace(/\s+/g,'').toLowerCase()).toBe('begin;commit;');
});

