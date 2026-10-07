#!/usr/bin/env node
// Static review artifact rendered from the actual public React components.
// Synthetic coverage only; no client script, form submission, or external assets.
import {createServer} from 'vite';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const server=await createServer({logLevel:'silent',server:{middlewareMode:true},appType:'custom'});
try {
  const {PublicMeals,MealCard}=await server.ssrLoadModule('/src/meals/PublicMeals.tsx');
  const slots=[
    {id:'sample-main',label:'Main dish',category:'main',unit:'tray (serves 15)',needed:2,confirmed:1,held:0,remaining:1},
    {id:'sample-side',label:'Side dish',category:'side',unit:'tray (serves 10)',needed:3,confirmed:1,held:1,remaining:1},
    {id:'sample-drink',label:'Drinks',category:'drink',unit:'case',needed:2,confirmed:0,held:0,remaining:2},
    {id:'sample-supply',label:'Plates & napkins',category:'supply',unit:'set for 30',needed:1,confirmed:1,held:0,remaining:0},
  ];
  const meal={id:'sample-one',title:'Build Saturday lunch',service_at:'2027-01-09T18:00:00Z',timezone:'America/Chicago',expected_headcount:30,guidance:'Sample coordinator-approved guidance: label ingredients and keep toppings separate. Ask the coordinator privately about dietary questions.',status:'open',whole_meal:'coordination_required',slots,version:1};
  const second={...meal,id:'sample-two',service_at:'2027-01-16T18:00:00Z',whole_meal:'available',slots:slots.map(s=>({...s,id:s.id+'-two',confirmed:0,held:0,remaining:s.needed}))};
  const cards='<div class="meal-list">'+[meal,second].map(m=>renderToStaticMarkup(createElement(MealCard,{meal:m,onChoose:()=>{}}))).join('')+'</div>';
  let body=renderToStaticMarkup(createElement(PublicMeals,{draft:true}));
  const loading=/<div class="meal-list"><\/div>/;
  if(!loading.test(body))throw Error('Preview insertion boundary changed');
  body=body.replace(loading,cards).replace('Refreshing…','Refresh coverage');
  const logo=readFileSync('public/branding/4418-impulse-emblem.png').toString('base64');
  body=body.replaceAll('src="/branding/4418-impulse-emblem.png"',`src="data:image/png;base64,${logo}"`);
  body=body.replaceAll('href="/meals.html"','href="#"');
  const css=readFileSync('src/design-system.css','utf8')+'\n'+readFileSync('src/meals/meals.css','utf8');
  const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow"><title>Saturday meals — static design review</title><style>'+css+'</style></head><body><div style="padding:12px 24px;background:#fff0c2;color:#47330a;font:15px Arial,sans-serif;text-align:center">Static design review · Sample dates and coverage · Buttons are illustrative, no signups or emails</div>'+body+'</body></html>';
  if(/<script|(?:src|href)=["']https?:|url\(["']?https?:/i.test(html))throw Error('Unexpected network/script content in static review');
  mkdirSync('review',{recursive:true});writeFileSync('review/meal-parent-preview.html',html);console.log('Created review/meal-parent-preview.html using actual React components (static, synthetic, no scripts).');
} finally {await server.close();}
