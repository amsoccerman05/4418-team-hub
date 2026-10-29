// Read-only public static downloads. Every response must be byte-identical to the
// freshly verified archived Pages manifest. Never build source or contact APIs.
import assert from 'node:assert/strict';import {mkdir,writeFile} from 'node:fs/promises';import {resolve,isAbsolute} from 'node:path';
import {manifest,assertManifest,assetPath,runtimeFiles,sha256,verifyArtifacts} from './handoff-artifacts.mjs';
assert(!process.env.HANDOFF_LIVE,'HANDOFF_LIVE is forbidden');const root=process.env.HANDOFF_DIST_ROOT;assert(root&&isAbsolute(root),'Explicit output root required');assertManifest(manifest);
for(const [app,a]of Object.entries(manifest.apps))for(const [file,digest]of runtimeFiles(a)){
 const url=a.origin+'/'+assetPath(file);const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000)});assert(response.ok,`${app}/${file} HTTP ${response.status}`);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(sha256(bytes),digest,`${app}/${file} changed since archived release; no rebuild/substitution allowed`);const path=resolve(root,app,file);await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path,bytes);
}
await verifyArtifacts(root);console.log('Verified four exact archived release byte sets from public static delivery; no live backend traffic.');
