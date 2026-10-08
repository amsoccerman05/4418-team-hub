import { test, expect } from '@playwright/test';
import { createMealManagerVerifier } from '../supabase/functions/team-meals/auth.ts';
const id='00000000-0000-0000-0000-000000000001';
const request=(value?:string)=>new Request('https://meal.example.invalid/api',{headers:value?{Authorization:value}:{}});

test('Auth verifier contacts only configured authority, ignores metadata and returns verified subject',async()=>{
  const calls:{url:string;init:RequestInit}[]=[];
  const verify=createMealManagerVerifier({authBaseUrl:'https://auth.example.invalid',publicApiKey:'synthetic-public-key',fetcher:async(url,init)=>{
    calls.push({url,init});return Response.json({id,user_metadata:{role:'admin',active:true},email:'synthetic@example.invalid'});
  }});
  expect(await verify(request())).toBeNull();expect(await verify(request('not-a-bearer'))).toBeNull();expect(calls).toHaveLength(0);
  expect(await verify(request('Bearer synthetic-session'))).toEqual({id});expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe('https://auth.example.invalid/auth/v1/user');expect(calls[0].init.redirect).toBe('error');expect(calls[0].init.cache).toBe('no-store');
  expect(calls[0].init.headers).toEqual({apikey:'synthetic-public-key',Authorization:'Bearer synthetic-session'});
});

test('Auth verifier fails closed for authority failure, malformed identity and anonymous users',async()=>{
  for(const body of [{},{id:'forged'},{id,is_anonymous:true},[{id}],null]) {
    const verify=createMealManagerVerifier({authBaseUrl:'http://127.0.0.1:54331',publicApiKey:'synthetic',fetcher:async()=>Response.json(body)});
    expect(await verify(request('Bearer synthetic-session'))).toBeNull();
  }
  for(const fetcher of [async()=>new Response('',{status:401}),async()=>{throw new Error('Synthetic network failure');},async()=>new Response('not JSON')]) {
    const verify=createMealManagerVerifier({authBaseUrl:'https://auth.example.invalid',publicApiKey:'synthetic',fetcher});
    expect(await verify(request('Bearer synthetic-session'))).toBeNull();
  }
});

test('Auth verifier rejects unsafe destination configuration and does not cache identities',async()=>{
  for(const authBaseUrl of ['http://remote.example.invalid','https://user:secret@auth.example.invalid','https://auth.example.invalid/path','https://auth.example.invalid?key=secret','https://auth.example.invalid#hash'])
    expect(()=>createMealManagerVerifier({authBaseUrl,publicApiKey:'synthetic',fetcher:async()=>Response.json({id})})).toThrow(/trusted/);
  let calls=0;const verify=createMealManagerVerifier({authBaseUrl:'https://auth.example.invalid',publicApiKey:'synthetic',fetcher:async()=>{calls++;return calls===1?Response.json({id}):new Response('',{status:401});}});
  expect(await verify(request('Bearer same-session'))).toEqual({id});expect(await verify(request('Bearer same-session'))).toBeNull();expect(calls).toBe(2);
});

test('plain HTTP Docker Auth requires an exact explicit single-label local-test host', async () => {
  const common = { publicApiKey: 'synthetic-public-key', fetcher: async () => Response.json({ id }) };
  expect(() => createMealManagerVerifier({ ...common, authBaseUrl: 'http://kong:8000' })).toThrow(/trusted/);
  const verify = createMealManagerVerifier({ ...common, authBaseUrl: 'http://kong:8000', localTestHost: 'kong' });
  expect(await verify(request('Bearer synthetic-session'))).toEqual({ id });
  for (const [authBaseUrl, localTestHost] of [
    ['http://evil:8000', 'kong'], ['http://external.example.com', 'external.example.com'],
    ['http://kong:8000', '*'], ['http://kong:8000', 'kong:8000'], ['http://kong:8000', 'kong/extra'],
  ]) expect(() => createMealManagerVerifier({ ...common, authBaseUrl, localTestHost })).toThrow(/trusted/);
});

test('configured legacy service-role keys are rejected while legacy anon keys remain supported', async () => {
  const common = { authBaseUrl: 'https://auth.example.invalid', fetcher: async () => Response.json({ id }) };
  const legacy = (role: string) => `${btoa('{"alg":"HS256"}')}.${btoa(JSON.stringify({ role }))}.synthetic-signature`;
  expect(() => createMealManagerVerifier({ ...common, publicApiKey: legacy('service_role') })).toThrow('public Auth API key');
  expect(() => createMealManagerVerifier({ ...common, publicApiKey: 'header.malformed.signature' })).toThrow('public Auth API key');
  expect(await createMealManagerVerifier({ ...common, publicApiKey: legacy('anon') })(request('Bearer synthetic-user-session'))).toEqual({ id });
});
