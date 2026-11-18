import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkAudit,exception} from '../scripts/dependency-audit.mjs';
const now=Date.parse('2026-11-18T03:00:00Z');
function fixture(){return {report:{auditReportVersion:2,metadata:{vulnerabilities:{high:2,critical:0}},vulnerabilities:{picomatch:{severity:'high',nodes:['node_modules/picomatch'],via:[{name:'picomatch',url:exception.advisory,severity:'high'}]},vite:{severity:'high',nodes:['node_modules/vite'],via:['picomatch']}}},lock:{packages:{'node_modules/picomatch':{version:'4.0.7',dev:true},'node_modules/vite':{version:'6.4.5',dev:true}}}};}
test('only exact pinned dev-only advisory and propagation allowed',()=>{const {report,lock}=fixture();assert.equal(checkAudit(report,lock,now),true)});
for(const [name,mutate] of Object.entries({
 'other advisory':({report})=>report.vulnerabilities.picomatch.via.push({name:'picomatch',url:'https://github.com/advisories/GHSA-other',severity:'high'}),
 'production dependency':({lock})=>lock.packages['node_modules/picomatch'].dev=false,
 'different version':({lock})=>lock.packages['node_modules/picomatch'].version='4.0.8',
 'different location':({report})=>report.vulnerabilities.picomatch.nodes=['node_modules/other/node_modules/picomatch'],
 'critical severity':({report})=>report.vulnerabilities.picomatch.severity='critical',
 'audit unavailable':({report})=>report.error={message:'network error'},
 'cycle':({report})=>report.vulnerabilities.picomatch.via=['vite'],
 'missing graph':({report})=>report.vulnerabilities.vite.via=['missing'],
 'empty graph':({report})=>report.vulnerabilities.picomatch.via=[],
})){test('rejects '+name,()=>{const f=fixture();mutate(f);assert.throws(()=>checkAudit(f.report,f.lock,now));});}
test('expires within seven days, fails closed at expiry',()=>{const f=fixture();assert.ok(Date.parse(exception.expires)-now<=7*86400000);assert.throws(()=>checkAudit(f.report,f.lock,Date.parse(exception.expires)));});
test('clean audit needs no exception even after expiry',()=>assert.equal(checkAudit({auditReportVersion:2,metadata:{vulnerabilities:{high:0,critical:0}},vulnerabilities:{}},{},Date.parse(exception.expires)),false));
