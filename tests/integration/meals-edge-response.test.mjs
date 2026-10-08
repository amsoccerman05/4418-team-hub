import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mealEdgeResponse } from './meals-edge.spec.mjs';
test('successful void-operation JSON null is a valid Edge response', async () => {
  assert.equal(await mealEdgeResponse(Response.json(null)), null);
  assert.deepEqual(await mealEdgeResponse(Response.json({ status: 'confirmed' })), { status: 'confirmed' });
});
test('unexpected HTTP status reports an assertion for null/object bodies without dereferencing null', async () => {
  await assert.rejects(mealEdgeResponse(Response.json(null, { status: 503 })), { name: 'AssertionError', message: /HTTP 503; code=unspecified/ });
  await assert.rejects(mealEdgeResponse(Response.json({ error: { code: 'invalid_link' } }, { status: 403 })), { name: 'AssertionError', message: /HTTP 403; code=invalid_link/ });
  assert.deepEqual(await mealEdgeResponse(Response.json({ error: { code: 'invalid_link' } }, { status: 403 }), 403), { error: { code: 'invalid_link' } });
});
