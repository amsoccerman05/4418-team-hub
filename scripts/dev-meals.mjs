#!/usr/bin/env node
/** LOCAL ONLY. No provider, Supabase credentials, persistent data, or outbound email. */
import { createServer as httpServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createServer as viteServer } from 'vite';
import { createMockBackend } from '../supabase/functions/team-meals/mock.ts';

const host = '127.0.0.1', uiPort = 4430, apiPort = 4432;
const origin = `http://${host}:${uiPort}`, apiOrigin = `http://${host}:${apiPort}`;
const managerToken = randomBytes(32).toString('base64url');
const slots = () => [
  {label:'Main dish',category:'main',unit:'tray (serves 15)',needed:2},
  {label:'Side dish',category:'side',unit:'tray (serves 10)',needed:3},
  {label:'Drinks',category:'drink',unit:'case',needed:2},
  {label:'Plates & napkins',category:'supply',unit:'set for 30',needed:1},
];
const backend = createMockBackend({ managerToken, mailMode:'mock', allowedOrigins:[origin], meals:[
  {title:'Build Saturday lunch',service_at:'2027-01-09T18:00:00Z',timezone:'America/Chicago',expected_headcount:30,guidance:'Sample coordinator-approved guidance: label ingredients and keep toppings separate. No individual dietary records are collected here.',status:'open',slots:slots()},
  {title:'Build Saturday lunch',service_at:'2027-01-16T18:00:00Z',timezone:'America/Chicago',expected_headcount:30,guidance:'Sample guidance only. The coordinator will review the menu before the meal.',status:'open',slots:slots()},
  {title:'Build Saturday lunch',service_at:'2027-01-23T18:00:00Z',timezone:'America/Chicago',expected_headcount:30,guidance:'Sample date, awaiting a final headcount.',status:'closed',slots:slots()},
] });
const headers = {'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'content-type,x-meals-demo','Access-Control-Allow-Methods':'POST,GET,OPTIONS','Vary':'Origin'};
const api = httpServer(async (req,res) => {
  const finish=(status,body)=>{res.writeHead(status,headers);res.end(JSON.stringify(body));};
  if (req.headers.host !== `${host}:${apiPort}` || !['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '')) return finish(403,{error:{code:'local_only',message:'Local preview only'}});
  if (req.headers.origin && req.headers.origin !== origin) return finish(403,{error:{code:'origin',message:'Origin not allowed'}});
  if (req.method === 'OPTIONS') { res.writeHead(204,headers);res.end();return; }
  if (req.method === 'GET' && req.url === '/__demo/mailbox') {
    // Synthetic mailbox, accessible only on loopback. Never deployed or logged.
    return finish(200,{mode:'mock',message:'These are captured test messages. No email was sent.',messages:backend.mailbox});
  }
  if (req.method !== 'POST' || req.url !== '/' || req.headers['x-meals-demo'] !== 'true' || req.headers.origin !== origin) return finish(403,{error:{code:'local_only',message:'Use the local preview page'}});
  try {
    const chunks=[];let size=0;
    for await (const chunk of req) { size+=chunk.length;if(size>16384)return finish(413,{error:{code:'too_large',message:'Request too large'}});chunks.push(chunk); }
    const body=Buffer.concat(chunks).toString('utf8');
    // Authority exists only inside this isolated synthetic dev server, never in the browser.
    const response=await backend.handle(new Request(apiOrigin,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:`Bearer ${managerToken}`},body}),{ip:req.socket.remoteAddress || host});
    res.writeHead(response.status,{...headers,...Object.fromEntries(response.headers)});res.end(await response.text());
  } catch { finish(500,{error:{code:'preview_error',message:'The local preview request failed'}}); }
});
// Explicitly overwrite client configuration; do not inherit a production connection.
process.env.VITE_MEALS_DEMO='true'; process.env.VITE_MEALS_API_URL=apiOrigin;
process.env.VITE_SUPABASE_URL=''; process.env.VITE_SUPABASE_ANON_KEY='';
const vite=await viteServer({server:{host,port:uiPort,strictPort:true},clearScreen:false});
try {
  await new Promise((resolve,reject)=>{api.once('error',reject);api.listen(apiPort,host,resolve);});
  await vite.listen();
  console.log(`Synthetic local preview: ${origin}/meals.html`);
  console.log(`Coordinator preview: ${origin}/meals-manager.html`);
  console.log(`Captured test messages: ${apiOrigin}/__demo/mailbox`);
  console.log('Use only .invalid email addresses. Nothing is saved after restart. No email is sent.');
} catch(error) { await vite.close();api.close();console.error(error instanceof Error?error.message:'Preview failed');process.exitCode=1; }
for(const signal of ['SIGINT','SIGTERM']) process.once(signal,async()=>{await vite.close();api.close();});
