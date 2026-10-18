import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
test('parent presentation renders honest empty states and labeled examples remain opt-in',async()=>{
 const server=await createServer({logLevel:'silent',server:{middlewareMode:true},appType:'custom'});
 try {
  const {ParentHome,ParentHomePreview}=await server.ssrLoadModule('/src/parents/ParentHome.tsx');
  const preview=renderToStaticMarkup(createElement(ParentHomePreview));
  expect(preview).toContain('Design preview');expect(preview).toContain('not connected');
  expect(preview).not.toContain('Saturday build meeting');expect(preview).not.toContain('checked=');
  const html=renderToStaticMarkup(createElement(ParentHome,{data:{events:[],needs:[],announcements:[]},onSignups:()=>{}}));
  for(const title of ['Parent home','Coming up','Coach updates','Ways to help','My signups'])expect(html).toContain(title);
  expect(html).toContain('No family calendar is connected');expect(html).not.toMatch(/<form|<iframe|student|strike|roster/i);
 }finally{await server.close();}
});
test('family content is rendered as escaped text; no data access in presentation module',async()=>{
 const server=await createServer({logLevel:'silent',server:{middlewareMode:true},appType:'custom'});
 try {
  const {ParentHome}=await server.ssrLoadModule('/src/parents/ParentHome.tsx');
  const html=renderToStaticMarkup(createElement(ParentHome,{data:{events:[],needs:[],announcements:[{id:'sample',title:'<script>alert(1)</script>',date:'Example only',body:'<img src=x onerror=alert(1)>'}]},onSignups:()=>{}}));
  expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');expect(html).not.toContain('<img src=x');
  const src=readFileSync('src/parents/ParentHome.tsx','utf8');
  expect(src).not.toMatch(/supabase|fetch\(|localStorage|sessionStorage|setInterval|dangerouslySetInnerHTML/);
  const main=readFileSync('src/main.tsx','utf8');expect(main.indexOf('if(!auth.signed)return auth.panel')).toBeLessThan(main.indexOf('{parentPreview&&<ParentHomePreview/>}'));
 }finally{await server.close();}
});
