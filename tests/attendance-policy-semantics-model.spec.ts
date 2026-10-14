import { test, expect } from '@playwright/test';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
let dir:string, api:any;
test.beforeAll(()=>{
 dir=mkdtempSync(join(tmpdir(),'policy-semantics-'));
 const output=join(dir,'render.cjs');
 buildSync({stdin:{contents:`export {createElement} from 'react';export {renderToStaticMarkup} from 'react-dom/server';export {PolicyHelp} from './src/attendance/PolicyDashboard';export {strikeAction,noticeTiming,inStrikeYear} from './src/attendance/service';`,resolveDir:resolve('.')},bundle:true,platform:'node',format:'cjs',jsx:'automatic',define:{'import.meta.env':'{}'},outfile:output,logLevel:'silent'});
 api=createRequire(import.meta.url)(output);
});
test.afterAll(()=>rmSync(dir,{recursive:true,force:true}));
test('proposed summary uses the supplied terms, human decisions, and honest reset caveat',()=>{
 const html=api.renderToStaticMarkup(api.createElement(api.PolicyHelp));
 for(const text of ['v1.0 (Proposed)','First notice','Second notice','Third notice','Fourth notice','Fifth notice','may result in removal','does not contact a parent or remove a member','policy says notices reset at kickoff','January 1 (UTC)','24 hours','five-minute','seven days','16 hours','10 hours','honor system','private medical information','Slack does not replace a website request'])expect(html).toContain(text);
 for(const text of ['v0.3','removal threshold','parent confirmation required','attendance-v03.pdf'])expect(html).not.toContain(text);
});
test('notice progression is presentation only with the existing 2 and 5 boundaries',()=>{
 expect(api.strikeAction(0)).toBe('No active attendance notices');
 expect(api.strikeAction(1)).toContain('Remind member');
 expect(api.strikeAction(2)).toContain('Mentor discussion and parent / guardian contact');
 for(const n of [3,4])expect(api.strikeAction(n)).toContain('Continued member / family communication');
 for(const n of [5,6])expect(api.strikeAction(n)).toBe('Leadership participation review required');
});
test('24-hour cutoff and UTC annual counting remain unchanged',()=>{
 const meeting={starts_at:'2026-10-14T18:00:00Z'};
 expect(api.noticeTiming({notice_at:'2026-10-13T18:00:00Z'},meeting)).toBe('At least 24 hours’ notice');
 expect(api.noticeTiming({notice_at:'2026-10-13T18:00:00.001Z'},meeting)).toContain('approved exception requires review');
 expect(api.noticeTiming({notice_at:null},meeting)).toBe('No request submitted');
 const data={policy:{strike_year_start:'2026-01-01T00:00:00Z'}};
 expect(api.inStrikeYear(data,{assigned_at:'2025-12-31T23:59:59Z'})).toBe(false);
 expect(api.inStrikeYear(data,{assigned_at:'2026-01-01T00:00:00Z'})).toBe(true);
});
test('legacy routes and write contract remain compatible; policy upload is not implied',()=>{
 const source=readFileSync('src/attendance/Attendance.tsx','utf8');
 for(const text of ['name === "strikes" ? "Attendance Notices"','manage("strike",','strike_id: s.id','automatic_absence_strike_count:','automatic_absence_strike_attendance_ids:'])expect(source).toContain(text);
 const workspace=readFileSync('src/attendance/PolicyDashboard.tsx','utf8');
 expect(workspace).toContain('action:"warning_parent_contact"');
 expect(workspace).toContain('href="#attendance/strikes"');
 expect(source).toContain('{ before: h.before_data, after: h.after_data }');
});
