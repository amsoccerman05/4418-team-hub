// XML 1.0 Char production: tab, LF, CR, U+0020–D7FF, U+E000–FFFD,
// and U+10000–10FFFF. Unicode mode treats a valid surrogate pair as one
// supplementary code point, while matching an unpaired surrogate as invalid.
const INVALID_XML_CHARACTER=/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/u;

const FIELD_LABELS:Record<string,string>={
 review:'',projects:'project',agenda:'agenda item',update:'',supporters:'supporter',
 evidence:'evidence reference',decisionReferences:'external decision reference',
 nextTask:'next task',owners:'owner',reportedBy:'student participant',
 carriedFrom:'previous review',priorUnresolved:'prior unresolved project',
 reviewId:'review ID',referenceId:'reference ID',asOf:'snapshot time',
};
function readableField(path:string):string {
 const parts=Array.from(path.matchAll(/([^.[\]]+)(?:\[(\d+)\])?/g),match=>{
  const label=FIELD_LABELS[match[1]]??match[1].replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase();
  return label+(match[2]===undefined?'':` ${Number(match[2])+1}`);
 }).filter(Boolean).join(' ')||'Presentation text';
 return parts[0].toUpperCase()+parts.slice(1);
}
export class ReviewExportTextError extends Error {
 constructor(readonly sourcePath:string,readonly codePoint:string){
  super(`Cannot export this review: ${readableField(sourcePath)} contains ${codePoint}, which PowerPoint XML does not support. Correct the source text and try again.`);
  this.name='ReviewExportTextError';
 }
}

function assertXmlText(value:string,path:string):void {
 const invalid=value.match(INVALID_XML_CHARACTER);
 if(!invalid)return;
 const code=invalid[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4,'0');
 throw new ReviewExportTextError(path,`U+${code}`);
}

/** Validate before formatting can trim controls, normalize URLs, or replace broken UTF-16. */
export function assertXmlSourceText(value:unknown,path='review'):void {
 if(typeof value==='string'){assertXmlText(value,path);return;}
 if(Array.isArray(value)){value.forEach((item,index)=>assertXmlSourceText(item,`${path}[${index}]`));return;}
 if(value!==null&&typeof value==='object'){
  for(const [key,item] of Object.entries(value))assertXmlSourceText(item,`${path}.${key}`);
 }
}

export function escapeXml(value:string):string {
 assertXmlText(value,'presentation text');
 return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}
