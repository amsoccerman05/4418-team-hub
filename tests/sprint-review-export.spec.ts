import {test,expect} from '@playwright/test';
import {createSnapshotPptx,createReviewExportSnapshot,safeReferenceUrl} from '../src/planning/reviews/export';
import {buildReviewDeckPlan,wrapText,textWidth} from '../src/planning/reviews/export/plan';
import {syntheticReviewSnapshot} from './fixtures/sprint-review-export';
test.use({launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}});
function unzipStore(bytes:Uint8Array){const parts:Record<string,string>={};let offset=0;const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),decoder=new TextDecoder();
 while(view.getUint32(offset,true)===0x04034b50){const size=view.getUint32(offset+18,true),n=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true),name=decoder.decode(bytes.subarray(offset+30,offset+30+n)),start=offset+30+n+extra;parts[name]=decoder.decode(bytes.subarray(start,start+size));offset=start+size;}return parts;}
test('editable native text/table parts, exact slide numbering and ordinary hyperlinks survive template filling',async()=>{
 const snapshot=syntheticReviewSnapshot(),result=await createSnapshotPptx(snapshot),parts=unzipStore(new Uint8Array(await result.blob.arrayBuffer()));
 const slideNames=Object.keys(parts).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n));expect(slideNames).toHaveLength(result.slideCount);
 expect(parts['ppt/presentation.xml'].match(/<p:sldId /g)).toHaveLength(result.slideCount);
 expect(slideNames.some(n=>parts[n].includes('<a:tbl>'))).toBe(true);
 expect(parts['ppt/slides/slide3.xml'].match(/<a:tr /g)).toHaveLength(3);
 expect(parts['ppt/slides/slide2.xml']).toContain('Oct 6, 2026');
 for(const name of slideNames){expect(parts[name]).toContain('<p:txBody>');expect(parts[name]).not.toContain('{{');}
 expect(Object.values(parts).join('\n')).toContain('https://example.com/evidence');
 expect(Object.values(parts).join('\n')).toContain('TargetMode="External"');
 expect(Object.values(parts).join('\n')).toContain('No image attached');
 expect(Object.values(parts).join('\n')).not.toContain('Bearer');
 const creationIds=slideNames.flatMap(n=>Array.from(parts[n].matchAll(/a16:creationId id="([^"]+)"/g),m=>m[1]));expect(new Set(creationIds).size).toBe(creationIds.length);
});
test('long prose and long agenda cells paginate without truncation or tiny type',async()=>{
 const snapshot=syntheticReviewSnapshot();const sentinel='END_OF_COMPLETE_REVIEW';snapshot.projects[0].update!.progress=('A long synthetic update with a full evidence description. ').repeat(110)+sentinel;
 snapshot.agenda[0].title=('Detailed synthetic agenda item ').repeat(20)+'AGENDA_END';
 const plan=buildReviewDeckPlan(snapshot);expect(plan.slides.length).toBeGreaterThan(20);
 const text=plan.slides.flatMap(s=>Object.values(s.slots)).join(' ');expect(text).toContain(sentinel);expect(text).toContain('AGENDA_END');
 for(const slide of plan.slides.filter(s=>s.layout===2))for(let i=0;i<10;i++)expect(textWidth(slide.slots[`LINE${i}`])).toBeLessThanOrEqual(850.01);
 const longWord='W'.repeat(200);expect(wrapText(longWord).join('')).toBe(longWord);
});
test('XML metacharacters remain literal and unsafe URLs never become links',async()=>{
 const snapshot=syntheticReviewSnapshot();snapshot.title='<script>& "literal"';snapshot.projects[0].update!.progress='Safe <tag> & text';
 const {blob}=await createSnapshotPptx(snapshot),parts=unzipStore(new Uint8Array(await blob.arrayBuffer()));expect(Object.values(parts).join('')).toContain('Safe &lt;tag&gt; &amp; text');expect(Object.values(parts).join('')).not.toContain('<script>');
 for(const url of ['javascript:alert(1)','file:///private','data:text/html,x','https://secret:password@example.com','https://example.com/has space','https://example.com/\\path',' https://example.com','invalid'])expect(safeReferenceUrl(url)).toBeNull();
 expect(safeReferenceUrl('https://example.com/a?x=1&y=2')).toBe('https://example.com/a?x=1&y=2');
});
test('a detached snapshot ignores other reviews/seasons and redacts inaccessible canonical tasks',()=>{
 const context:any={selected_review_id:'r',season_id:'s',loaded_at:'now',reviews:[{id:'r',season_id:'s',title:'Selected',review_date:'2026-10-06',chair_id:null,agenda:[]},{id:'other',season_id:'s',title:'Other secret',review_date:'2026-10-05',chair_id:null,agenda:[]}],members:[],seasons:[{id:'s',name:'Season'}],boards:[{id:'b',season_id:'s',name:'Project',assignment:null},{id:'secret',season_id:'elsewhere',name:'Other season secret'}],previous_updates:[],updates:[{review_id:'r',board_id:'b',progress:'Current',blockers:'',tradeoffs:'',decisions_needed:'',evidence:[],reported_decision:'',decision_rationale:'',decision_references:[],reported_students:[],next_test:'',linked_task:{available:false,title:'Hidden task title',owners:[{name:'Hidden owner'}],due_date:'2027-01-01'},unresolved:false},{review_id:'other',board_id:'b',progress:'Other update secret'}]};
 const snapshot=createReviewExportSnapshot(context);const json=JSON.stringify(snapshot);expect(json).not.toContain('secret');expect(json).not.toContain('Hidden');expect(json).not.toContain('2027-01-01');
 context.updates[0].progress='Changed after snapshot';expect(snapshot.projects[0].update!.progress).toBe('Current');expect(()=>createReviewExportSnapshot(context,'missing')).toThrow(/loaded review/);
 expect(()=>createReviewExportSnapshot(context,'other')).toThrow(/loaded review/);
});
test('the browser export needs no server, SDK, credential or network access',async({page})=>{
 await page.goto('/');const snapshot=syntheticReviewSnapshot();
 const result=await page.evaluate(async snapshot=>{const module=await import('/src/planning/reviews/export/index.ts');const original=window.fetch;window.fetch=()=>{throw new Error('Unexpected export network request');};try{const result=await module.createSnapshotPptx(snapshot);return{size:result.blob.size,type:result.blob.type,slides:result.slideCount};}finally{window.fetch=original;}},snapshot);
 expect(result.size).toBeGreaterThan(1000);expect(result.type).toContain('presentationml');expect(result.slides).toBeGreaterThan(5);
});

test('Arial compatibility export is explicit, editable and disclosed',async()=>{
 const result=await createSnapshotPptx(syntheticReviewSnapshot(),{fontMode:'arial'}),parts=unzipStore(new Uint8Array(await result.blob.arrayBuffer()));
 const slides=Object.entries(parts).filter(([n])=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).map(([,x])=>x).join('');
 expect(slides).toContain('typeface="Arial"');expect(slides).not.toContain('typeface="Red Hat');expect(slides).toContain('b="1"');expect(result.warnings[0]).toContain('differs');
});


test('oversized exports fail visibly rather than returning a partial presentation',()=>{
 const snapshot=syntheticReviewSnapshot();snapshot.projects[0].update!.progress='W'.repeat(250000);
 expect(()=>buildReviewDeckPlan(snapshot)).toThrow(/500 slides/);
});
