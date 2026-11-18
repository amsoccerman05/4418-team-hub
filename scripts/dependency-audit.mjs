import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export const exception = {
  advisory: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf',
  expires: '2026-11-25T02:55:00Z',
  versions: {picomatch:'4.0.7',fdir:'6.5.0',tinyglobby:'0.2.17',vite:'6.4.5','@vitejs/plugin-react':'4.7.0'},
};
// Explicitly approved temporary BUILD-ONLY exception. Do not broaden this list.
export function checkAudit(report,lock,now=Date.now()) {
  if(report?.error||report?.auditReportVersion!==2||!report.vulnerabilities||!report.metadata?.vulnerabilities)throw Error('Invalid audit response');
  const entries=report.vulnerabilities;
  const high=Object.keys(entries).filter(n=>['high','critical'].includes(entries[n].severity));
  if(!high.length){if(report.metadata.vulnerabilities.high||report.metadata.vulnerabilities.critical)throw Error('Inconsistent audit counts');return false;}
  if(now>=Date.parse(exception.expires))throw Error('Temporary build-only exception expired');
  const visit=(name,seen=new Set())=>{
    if(seen.has(name))throw Error('Unexpected advisory cycle');
    seen=new Set(seen).add(name);
    const v=entries[name],expected=exception.versions[name];
    if(!v||!expected||v.severity==='critical'||!Array.isArray(v.nodes)||!v.nodes.length||!Array.isArray(v.via)||!v.via.length)throw Error('Unapproved vulnerability: '+name);
    for(const node of v.nodes){const p=lock.packages?.[node];if(node!=='node_modules/'+name||!p||p.dev!==true||p.version!==expected)throw Error('Exception is not exact pinned dev-only dependency: '+name);}
    for(const via of v.via){
      if(typeof via==='string')visit(via,seen);
      else if(name!=='picomatch'||via.name!=='picomatch'||via.url!==exception.advisory||via.severity!=='high')throw Error('Unapproved advisory: '+(via?.url||name));
    }
  };
  for(const name of high)visit(name);
  return true;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const result=spawnSync('npm',['audit','--json'],{encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024});
    if(result.error||result.signal||![0,1].includes(result.status))throw Error('npm audit execution failed');
    const used=checkAudit(JSON.parse(result.stdout),JSON.parse(readFileSync('package-lock.json','utf8')));
    console.log(used?`Approved BUILD-ONLY exception: ${exception.advisory}; expires ${exception.expires}. All other high/critical advisories rejected.`:'No high/critical dependency advisories.');
  }catch(error){console.error(error.message);process.exitCode=1;}
}
