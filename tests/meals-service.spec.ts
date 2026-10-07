import { test, expect } from '@playwright/test';
import { transform } from 'esbuild';
import { readFileSync } from 'node:fs';

async function service(env:Record<string,string> = {}) {
  const source = readFileSync('src/meals/service.ts','utf8');
  const result = await transform(source,{loader:'ts',format:'esm',target:'es2022',define:{'import.meta.env':JSON.stringify(env)}});
  return import('data:text/javascript;base64,' + Buffer.from(result.code + `\n// fixture ${Math.random()}`).toString('base64'));
}
const originalFetch=globalThis.fetch;
test.afterEach(()=>{globalThis.fetch=originalFetch;});
test('unconfigured normal builds fail closed without contacting a host',async()=>{
  let count=0;globalThis.fetch=async()=>{count++;throw Error('not expected');};
  const {mealApi}=await service();await expect(mealApi.list()).rejects.toMatchObject({code:'not_configured',status:503});expect(count).toBe(0);
});
test('demo cannot point at production, credentials, URL fragments or query tokens',async()=>{
  for(const url of ['https://team.frc4418.org/api','http://person:password@127.0.0.1:4432/','http://127.0.0.1:4432/?token=secret','http://127.0.0.1:4432/#secret']){
    const {mealApi}=await service({VITE_MEALS_DEMO:'true',VITE_MEALS_API_URL:url});
    await expect(mealApi.list()).rejects.toMatchObject({code:'invalid_configuration'});
  }
});
test('private link data uses POST body without URL, credentials, persistence, referrer, cache or redirect',async()=>{
  let captured:any;globalThis.fetch=async(url,init)=>{captured={url,init};return new Response(JSON.stringify({id:'private'}));};
  const {mealApi}=await service({VITE_MEALS_DEMO:'true',VITE_MEALS_API_URL:'http://127.0.0.1:4432/'});
  await mealApi.inspect('synthetic-private-token');
  expect(captured.url).toBe('http://127.0.0.1:4432/');
  expect(captured.init).toMatchObject({method:'POST',referrerPolicy:'no-referrer',credentials:'omit',cache:'no-store',redirect:'error'});
  expect(JSON.parse(captured.init.body)).toEqual({operation:'inspect',token:'synthetic-private-token'});
  expect(captured.init.headers.Authorization).toBeUndefined();
});
test('API preserves safe status/code for access and conflict handling',async()=>{
  globalThis.fetch=async()=>new Response(JSON.stringify({error:{code:'version_conflict',message:'This signup changed. Refresh first.'}}),{status:409});
  const {mealApi}=await service({VITE_MEALS_DEMO:'true',VITE_MEALS_API_URL:'http://127.0.0.1:4432/'});
  await expect(mealApi.edit('synthetic',{quantity:1,version:1})).rejects.toMatchObject({code:'version_conflict',status:409,message:'This signup changed. Refresh first.'});
});
test('uncertain writes are reported and never automatically replayed',async()=>{
  let count=0;globalThis.fetch=async()=>{count++;throw Error('network gone after submission');};
  const {mealApi}=await service({VITE_MEALS_DEMO:'true',VITE_MEALS_API_URL:'http://127.0.0.1:4432/'});
  await expect(mealApi.cancel('synthetic',{version:1})).rejects.toMatchObject({code:'uncertain_result',status:0});expect(count).toBe(1);
});
test('malformed service responses do not become successful saves',async()=>{
  globalThis.fetch=async()=>new Response('not-json',{status:200});
  const {mealApi}=await service({VITE_MEALS_DEMO:'true',VITE_MEALS_API_URL:'http://127.0.0.1:4432/'});
  await expect(mealApi.list()).rejects.toMatchObject({code:'unavailable'});
});

test('coordinator cancellation accepts a successful null body',async()=>{
  globalThis.fetch=async()=>new Response('null',{status:200});
  const {mealApi}=await service({VITE_MEALS_DEMO:'true',VITE_MEALS_API_URL:'http://127.0.0.1:4432/'});
  await expect(mealApi.cancelClaim({id:'synthetic',version:1,reason:'Coordinator test'})).resolves.toBeNull();
});

test('malformed coordinator cancellation is not reported as successful',async()=>{
  globalThis.fetch=async()=>new Response('not-json',{status:200});
  const {mealApi}=await service({VITE_MEALS_DEMO:'true',VITE_MEALS_API_URL:'http://127.0.0.1:4432/'});
  await expect(mealApi.cancelClaim({id:'synthetic',version:1,reason:'Test'})).rejects.toMatchObject({code:'uncertain_result'});
});
