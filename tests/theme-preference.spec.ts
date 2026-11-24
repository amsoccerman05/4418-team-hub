import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source = readFileSync('public/theme.js', 'utf8');
function boot(stored: string | null = null, dark = true, blocked = false) {
  const changes: Record<string, Function> = {};
  const controls: any[] = [];
  let Control: any;
  class Element {
    children: any[] = []; firstChild: any; value = ''; textContent = ''; listeners: Record<string, Function> = {};
    append(...items: any[]) { this.children.push(...items); this.firstChild = this.children[0]; }
    addEventListener(name: string, fn: Function) { this.listeners[name] = fn; }
  }
  const html = {dataset: {} as Record<string,string>, style: {} as Record<string,string>};
  const media = {matches: dark, addEventListener: (_: string, fn: Function) => {changes.media = fn;}};
  const storage = {getItem: () => {if(blocked)throw Error('Unavailable');return stored;}, setItem: (_:string,v:string) => {if(blocked)throw Error('Unavailable');stored=v;}};
  vm.runInNewContext(source, {window:{matchMedia:()=>media,addEventListener:(name:string,fn:Function)=>{changes[name]=fn;}},localStorage:storage,
    document:{documentElement:html,querySelector:()=>null,querySelectorAll:()=>controls,createElement:()=>new Element()},HTMLElement:Element,customElements:{define:(_:string,c:any)=>{Control=c;}}});
  const control = new Control(); control.connectedCallback();
  const select = control.children[0].children[1]; controls.push(select);
  return {html,select,control,stored:()=>stored,system(value:boolean){media.matches=value;changes.media();},choose(value:string){select.value=value;select.listeners.change();},crossTab(value:string|null){stored=value;changes.storage({key:'4418-team-hub-theme'});}};
}
test('device preference applies synchronously and tracks system changes',()=>{
  const app=boot(); expect(app.html.dataset.theme).toBe('dark');expect(app.html.style.colorScheme).toBe('dark');expect(app.select.value).toBe('system');
  app.system(false);expect(app.html.dataset.theme).toBe('light');
});
test('explicit choice survives reload and ignores device changes until System is selected',()=>{
  const app=boot();app.choose('light');app.system(true);expect(app.html.dataset.theme).toBe('light');
  const reloaded=boot(app.stored());expect(reloaded.html.dataset.theme).toBe('light');expect(reloaded.select.value).toBe('light');
  reloaded.choose('dark');reloaded.system(false);expect(reloaded.html.dataset.theme).toBe('dark');
  reloaded.choose('system');expect(reloaded.html.dataset.theme).toBe('light');
});
test('invalid or inaccessible storage safely defaults to System; blocked storage still allows a page override',()=>{
  expect(boot('invalid').select.value).toBe('system');const app=boot(null,true,true);app.choose('light');expect(app.html.dataset.theme).toBe('light');
});
test('other tabs synchronize preference and the control has a native wrapping label',()=>{
  const app=boot();app.crossTab('light');expect(app.html.dataset.theme).toBe('light');expect(app.select.value).toBe('light');
  app.crossTab(null);expect(app.select.value).toBe('system');expect(app.control.children[0].children[0]).toBe('Theme ');
  expect(app.select.children.map((o:any)=>o.value)).toEqual(['system','light','dark']);
});
test('dark palette text, muted text, semantic states, and filled actions meet normal-text contrast',()=>{
 const css=readFileSync('public/theme.css','utf8').split(':root[data-theme="dark"] {')[1].split('}')[0];
 const color=(token:string)=>css.match(new RegExp('--'+token+': (#[0-9a-f]{6})'))![1];
 const luminance=(hex:string)=>{const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];};
 for(const [text,bg] of [['suite-text','suite-surface'],['suite-muted','suite-surface'],['suite-primary','suite-background'],['suite-danger','suite-danger-bg'],['suite-warning','suite-warning-bg'],['suite-success','suite-success-bg']]){
  const a=luminance(color(text)),b=luminance(color(bg));expect((Math.max(a,b)+.05)/(Math.min(a,b)+.05),`${text} on ${bg}`).toBeGreaterThanOrEqual(4.5);
 }
 expect(1.05/(luminance(color('suite-primary-fill-hover'))+.05)).toBeGreaterThanOrEqual(4.5);
});
