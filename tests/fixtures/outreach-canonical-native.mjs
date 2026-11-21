// Narrow native concurrency fixture, not the full canonical migration proof.
// Full five-migration installation is tested by the real shared-security stack.
// This applies the exact captured and candidate Outreach definitions, never
// substitutes authority helpers or weakens any concurrency predicate.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=p=>readFileSync(new URL(`../../${p}`,import.meta.url),'utf8');
export function outreachCanonicalNative(){
 const pins=JSON.parse(read('tests/fixtures/canonical-workflow-definition-pins.json')).functions.filter(f=>f.signature.startsWith('outreach_private.'));
 const migration=read('supabase/migrations/20261029190442_canonical_roles_workflow_boundaries.sql');
 assert.equal(pins.length,8);
 return pins.map(pin=>{
  assert.equal(createHash('md5').update(pin.expected).digest('hex'),pin.expected_md5);
  assert(migration.includes(pin.expected.trim()),`Candidate definition absent: ${pin.signature}`);
  return pin.definition+'\n'+pin.expected;
 }).join('\n');
}
