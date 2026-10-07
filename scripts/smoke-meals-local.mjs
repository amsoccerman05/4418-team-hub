#!/usr/bin/env node
/** Owns one synthetic loopback server. No external network, credentials or mail. */
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const home=mkdtempSync(join(tmpdir(),'meals-smoke-'));
const child=spawn(process.execPath,['scripts/dev-meals.mjs'],{cwd:process.cwd(),env:{PATH:process.env.PATH,HOME:home,LANG:'C.UTF-8',TZ:'UTC'},stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
const exited=new Promise(resolve=>child.once('exit',resolve));
function http(port,path,body,headers={}){return new Promise((resolve,reject)=>{const r=request({hostname:'127.0.0.1',port,path,method:body?'POST':'GET',headers:{Origin:'http://127.0.0.1:4430','Content-Type':'application/json','X-Meals-Demo':'true',...headers},timeout:10000},res=>{let data='';res.on('data',c=>data+=c);res.on('end',()=>{try{resolve({status:res.statusCode,body:res.headers['content-type']?.includes('application/json')?JSON.parse(data):data});}catch(e){reject(e);}});});r.on('error',reject);r.on('timeout',()=>r.destroy(Error('Local request timed out')));r.end(body?JSON.stringify(body):undefined);});}
try {
  const deadline=Date.now()+15000;
  while(!output.includes('Synthetic local preview:')){if(child.exitCode!==null||Date.now()>deadline)throw Error('Local preview could not start: '+output);await new Promise(r=>setTimeout(r,100));}
  assert.equal((await http(4430,'/meals.html')).status,200);assert.equal((await http(4430,'/meals-manager.html')).status,200);assert.equal((await http(4430,'/src/meals/meal-public.tsx')).status,200);
  const call=body=>http(4432,'/',body),list=await call({operation:'list'});assert.equal(list.status,200);assert.equal(list.body.length,3);
  const meal=list.body[0],slot=meal.slots[0];
  const receipt=await call({operation:'claim',meal_id:meal.id,slot_id:slot.id,whole_meal:false,quantity:1,name:'Synthetic HTTP Adult',email:'http-parent@example.invalid',idempotency_key:crypto.randomUUID()});assert.equal(receipt.status,200);assert.equal(receipt.body.status,'pending_verification');assert.equal(receipt.body.email_status,'sent');
  const inbox=await http(4432,'/__demo/mailbox');assert.equal(inbox.body.messages.length,1);const mail=inbox.body.messages[0];assert.match(mail.verificationUrl,/\/meals\.html#verify=/);
  const verified=await call({operation:'verify',token:mail.verificationToken});assert.equal(verified.body.claim.status,'confirmed');
  const managed=await call({operation:'inspect',token:mail.manageToken});assert.equal(managed.body.id,verified.body.claim.id);
  const edited=await call({operation:'edit',token:mail.manageToken,version:managed.body.version,quantity:2});assert.equal(edited.body.quantity,2);
  const manager=await call({operation:'manager'});assert.equal(manager.body.mail_mode,'mock');assert.equal(manager.body.claims[0].email,'http-parent@example.invalid');
  const cancelled=await call({operation:'cancel',token:mail.manageToken,version:edited.body.version});assert.equal(cancelled.body.status,'cancelled');
  assert.equal((await call({operation:'inspect',token:mail.manageToken})).status,403);
  assert.equal((await http(4432,'/',{operation:'manager'},{Origin:'https://not-authorized.invalid'})).status,403);
  assert.equal((await http(4432,'/__demo/mailbox',undefined,{Origin:'https://not-authorized.invalid'})).status,403);
  console.log('PASS: local HTTP page/module boot, synthetic claim, mock mailbox, verify, emailed manage link, edit, manager snapshot, cancel/revoke, and cross-origin denial. No email or production request.');
} finally {child.kill('SIGTERM');await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,3000))]);if(child.exitCode===null)child.kill('SIGKILL');rmSync(home,{recursive:true,force:true});}
