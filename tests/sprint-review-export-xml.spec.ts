import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createSnapshotPptx,type ReviewExportSnapshot} from '../src/planning/reviews/export';
import {syntheticReviewSnapshot} from './fixtures/sprint-review-export';

/** Parse the actual ZIP parts using Python's independent, strict XML 1.0 parser. */
function inspectPptxXml(bytes:Uint8Array):{partCount:number;errors:string[];text:Record<string,string>}{
 return JSON.parse(execFileSync(process.env.CODEX_PRIMARY_RUNTIME_PYTHON||'python3',['-c',`
import io, json, sys, zipfile, xml.etree.ElementTree as ET
errors = []; text = {}; count = 0
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as package:
    assert package.testzip() is None, 'PPTX ZIP CRC validation failed'
    for name in package.namelist():
        if not name.endswith(('.xml', '.rels')): continue
        count += 1
        try:
            root = ET.fromstring(package.read(name))
            if name.startswith(('ppt/slides/', 'ppt/notesSlides/', 'docProps/')):
                text[name] = ''.join(root.itertext())
        except ET.ParseError as error:
            errors.append(name + ': ' + str(error))
print(json.dumps({'partCount': count, 'errors': errors, 'text': text}))
`],{input:bytes,encoding:'utf8',maxBuffer:2_000_000}));
}

test('XML 1.0 forbidden characters fail clearly before a malformed or silently changed PPTX is returned',async()=>{
 const invalid=[0xffff,0xfffe,...Array.from({length:0x20},(_,n)=>n).filter(n=>![9,10,13].includes(n)),0xd800,0xdbff,0xdc00,0xdfff];
 for(const code of invalid){
  const snapshot=syntheticReviewSnapshot();snapshot.projects[0].update!.progress=`Before${String.fromCharCode(code)}after`;
  let failure:unknown,exported;
  try {exported=await createSnapshotPptx(snapshot);} catch(error){failure=error;}
  if(exported){
   const parsed=inspectPptxXml(new Uint8Array(await exported.blob.arrayBuffer()));
   // On regression, distinguish genuinely malformed XML from silent Unicode replacement.
   expect(parsed.errors,`U+${code.toString(16)} produced invalid PPTX XML`).toEqual([]);
  }
  expect(failure,`U+${code.toString(16)} must prevent the export`).toBeInstanceOf(Error);
  expect((failure as Error).message).toContain('Cannot export this review');
  expect((failure as Error).message).toContain('Project 1 progress');
  expect(failure).toMatchObject({sourcePath:'review.projects[0].update.progress'});
  expect((failure as Error).message).toContain(`U+${code.toString(16).toUpperCase().padStart(4,'0')}`);
 }
});

test('XML preflight checks metadata, nested source fields and raw controls before formatting can hide them',async()=>{
 const cases:[string,(s:ReviewExportSnapshot)=>void][]=[
  ['review.title',s=>s.title='Title\ufffe'],['review.season',s=>s.season='Season\ufffe'],
  ['review.chair',s=>s.chair='Chair\ufffe'],['review.asOf',s=>s.asOf='Timestamp\ufffe'],
  ['review.agenda[0].presenter',s=>s.agenda[0].presenter='Presenter\ufffe'],
  ['review.projects[0].name',s=>s.projects[0].name='Project\ufffe'],
  ['review.projects[0].supporters[0]',s=>s.projects[0].supporters[0]='Supporter\ufffe'],
  ['review.projects[0].update.evidence[0].label',s=>s.projects[0].update!.evidence[0].label='Evidence\ufffe'],
  ['review.projects[0].update.evidence[0].referenceId',s=>s.projects[0].update!.evidence[0].referenceId='REF\ufffe'],
  ['review.projects[0].update.nextTask.owners[0]',s=>s.projects[0].update!.nextTask!.owners[0]='Owner\ufffe'],
  ['review.projects[0].update.nextTask.status',s=>s.projects[0].update!.nextTask!.status='Status\ufffe'],
  ['review.projects[0].update.progress',s=>s.projects[0].update!.progress='\u000b'],
 ];
 for(const [path,change] of cases){const snapshot=syntheticReviewSnapshot();change(snapshot);await expect(createSnapshotPptx(snapshot),path).rejects.toMatchObject({sourcePath:path,message:expect.stringContaining('Cannot export this review')});}
});

test('actual PPTX XML preserves valid supplementary characters and accepts XML 1.0 character boundaries',async()=>{
 const snapshot=syntheticReviewSnapshot();const text='Unicode 🚀 🤖 𠮷 𝄞';
 snapshot.title=text;snapshot.projects[0].update!.progress=text;
 snapshot.projects[0].update!.tradeoffs='Boundary\t\n\r \uD7FF\uE000\uFFFD\u{10000}\u{10FFFF}';
 for(const fontMode of ['reference','arial'] as const){
  const {blob}=await createSnapshotPptx(snapshot,{fontMode});
  const parsed=inspectPptxXml(new Uint8Array(await blob.arrayBuffer()));
  expect(parsed.partCount).toBeGreaterThan(30);expect(parsed.errors).toEqual([]);
  expect(parsed.text['docProps/core.xml']).toContain(text);
  const slides=Object.entries(parsed.text).filter(([name])=>/^ppt\/slides\/slide\d+\.xml$/.test(name)).map(([,value])=>value).join('\n');
  const notes=Object.entries(parsed.text).filter(([name])=>/^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name)).map(([,value])=>value).join('\n');
  for(const value of [text,'\uD7FF\uE000\uFFFD\u{10000}\u{10FFFF}']){expect(slides).toContain(value);expect(notes).toContain(value);}
 }
});

test('deterministic valid synthetic sample bytes stay unchanged',async()=>{
 const hashes={reference:'73b275b1cadf273912af8fbc49920d7262aabe9501370c94d57db0612383fe83',arial:'005fb1b7632eb3afc9d784c8db056ab3c39e8fa41b946c4523eeda8053e183fa'};
 for(const fontMode of ['reference','arial'] as const){
  const {blob}=await createSnapshotPptx(syntheticReviewSnapshot(),{fontMode});
  const bytes=new Uint8Array(await blob.arrayBuffer());expect(createHash('sha256').update(bytes).digest('hex')).toBe(hashes[fontMode]);
  expect(inspectPptxXml(bytes).errors).toEqual([]);
 }
});
