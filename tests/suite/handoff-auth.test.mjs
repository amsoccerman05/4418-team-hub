import {test} from 'node:test';
import assert from 'node:assert/strict';
import {issuedTokens} from './handoff-auth.mjs';
test('protected fixture reads reject missing, public anon and unissued bearer credentials',()=>{
  const auth=issuedTokens(()=>'fixture-issued-token');
  for(const header of [undefined,'','Bearer public-anon-key','Bearer fixture-issued-token','Basic fixture-issued-token'])assert.equal(auth.accepts(header),false);
  const token=auth.issue();
  assert.equal(auth.accepts(`Bearer ${token}`),true);
  for(const header of ['Bearer public-anon-key','Bearer forged-token',`Bearer ${token} extra`])assert.equal(auth.accepts(header),false);
});
test('issued credentials cannot authorize another isolated browser fixture',()=>{
  const first=issuedTokens(()=>'first-context-token'),second=issuedTokens(()=>'second-context-token');
  assert.equal(second.accepts(`Bearer ${first.issue()}`),false);
});
