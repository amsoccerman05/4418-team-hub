import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,isAbsolute} from 'node:path';
export const sha256=b=>createHash('sha256').update(b).digest('hex');
export const manifest=JSON.parse(await readFile(new URL('./released-artifacts.json',import.meta.url),'utf8'));
export function assetPath(path){assert(typeof path==='string'&&path.length>0&&!path.includes('\\')&&!path.startsWith('/')&&!path.split('/').some(p=>p==='..'||p==='.'||p===''),'Unsafe artifact path');return path;}
export function assertManifest(m){assert.equal(m.kind,'exact-archived-released-pages');assert.deepEqual(Object.keys(m.apps).sort(),['finance','hub','inventory','pit']);for(const [app,a]of Object.entries(m.apps)){assert.equal(a.origin,`https://${app==='hub'?'team':app}.frc4418.org`);assert(/^[0-9a-f]{40}$/.test(a.commit));assert(Number.isSafeInteger(a.run)&&Number.isSafeInteger(a.artifact));assert(/^[0-9a-f]{64}$/.test(a.archive_sha256));assert(a.files['index.html']);for(const [file,digest]of Object.entries(a.files)){assetPath(file);assert(/^[0-9a-f]{64}$/.test(digest));}}return m;}
export function runtimeFiles(app){return Object.entries(app.files).filter(([file])=>file!=='CNAME');}
export async function loadArtifacts(root=process.env.HANDOFF_DIST_ROOT){assert(!process.env.HANDOFF_LIVE,'HANDOFF_LIVE is forbidden');assert(root&&isAbsolute(root),'Explicit absolute HANDOFF_DIST_ROOT required');assertManifest(manifest);const assets=new Map();for(const [app,a]of Object.entries(manifest.apps))for(const [file,digest]of runtimeFiles(a)){const bytes=await readFile(resolve(root,app,assetPath(file)));assert.equal(sha256(bytes),digest,`${app}/${file} differs from archived release`);assets.set(a.origin+'/'+file,bytes);}return assets;}
export async function verifyArtifacts(root){await loadArtifacts(root);}
