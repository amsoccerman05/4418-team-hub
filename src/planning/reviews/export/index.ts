import type {SprintReviewContext} from '../types';
import {createReviewExportSnapshot,safeReferenceUrl,type ReviewExportSnapshot} from './snapshot';
import {buildReviewDeckPlan,type DeckSlide,type ReviewExportOptions} from './plan';
import {TEMPLATE_PARTS} from './template.generated';
import {storeZip,type ZipEntry} from './zip';
import {assertXmlSourceText,escapeXml} from './xml';
export {createReviewExportSnapshot,safeReferenceUrl} from './snapshot';
export type {ReviewExportOptions} from './plan';
export type {ReviewExportSnapshot} from './snapshot';
export {buildReviewDeckPlan} from './plan';
export type ReviewPptxResult={blob:Blob;filename:string;slideCount:number;warnings:string[]};
const REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const encoder=new TextEncoder();
function textPart(name:string):string{const part=TEMPLATE_PARTS[name];if(!part||part.kind!=='text')throw new Error('Presentation template is incomplete.');return part.value;}
function appendRelationships(xml:string,rows:string[]):string{return xml.replace('</Relationships>',rows.join('')+'</Relationships>');}
function relationship(type:string,target:string,id:string,external=false){return `<Relationship Type="${REL}${type}" Target="${escapeXml(target)}" Id="${id}"${external?' TargetMode="External"':''}/>`;}
function fill(xml:string,values:Record<string,string>):string{
 return xml.replace(/\{\{([A-Z0-9_]+)\}\}/g,(_,key:string)=>{if(!(key in values))throw new Error(`Missing presentation field: ${key}`);return escapeXml(values[key]);});
}
function fillSlide(slide:DeckSlide,index:number):{xml:string;rels:string;notes:string;notesRels:string}{
 let xml=textPart(`ppt/slides/slide${slide.layout}.xml`),rels=textPart(`ppt/slides/_rels/slide${slide.layout}.xml.rels`);
 // PowerPoint creation IDs are persistent object identities. Copies receive new IDs
 // so editors/importers do not merge repeated titles or repeated project context.
 let objectIndex=0;
 xml=xml.replace(/(<a16:creationId id=")[^"]+(")/g,(_all,start,end)=>`${start}{${index.toString(16).padStart(8,'0')}-4418-4000-8000-${(++objectIndex).toString(16).padStart(12,'0')}}${end}`);
 const linkRows:string[]=[];
 for(const slot of slide.labels??[]){xml=xml.replace(/<a:r>.*?<\/a:r>/gs,run=>run.includes(`<a:t>{{${slot}}}</a:t>`)?run.replace(/typeface="Red Hat Text"/g,'typeface="Red Hat Display Black"').replace(/val="FFFFFF"/g,'val="F1C232"'):run);}
 for(const [slot,url] of Object.entries(slide.links)){
  if(!safeReferenceUrl(url))throw new Error('Unsafe hyperlink in presentation plan.');
  const id=`reviewLink${linkRows.length+1}`;
  xml=xml.replace(/<a:r>.*?<\/a:r>/gs,run=>run.includes(`<a:t>{{${slot}}}</a:t>`)?run.replace('<a:rPr ','<a:rPr u="sng" ').replace('</a:rPr>',`<a:hlinkClick r:id="${id}" xmlns:r="${REL.slice(0,-1)}"/></a:rPr>`):run);
  linkRows.push(relationship('hyperlink',url,id,true));
 }
 // Update the existing authored notes relationship, preserving layout and image relationships.
 rels=rels.replace(/Target="\/ppt\/notesSlides\/notesSlide\d+\.xml"/g,`Target="/ppt/notesSlides/notesSlide${index}.xml"`);
 rels=appendRelationships(rels,linkRows);
 const notes=fill(textPart(`ppt/notesSlides/notesSlide${slide.layout}.xml`),{NOTES:slide.notes});
 const notesRels=textPart(`ppt/notesSlides/_rels/notesSlide${slide.layout}.xml.rels`).replace(/Target="\/ppt\/slides\/slide\d+\.xml"/g,`Target="/ppt/slides/slide${index}.xml"`);
 xml=fill(xml,slide.slots);
 if(slide.layout===3){
  const rows=Number(slide.slots.ROW_COUNT);
  if(!Number.isInteger(rows)||rows<1||rows>4)throw new Error('Invalid agenda row count.');
  xml=xml.replace(/<p:graphicFrame>.*?<\/p:graphicFrame>/gs,frame=>{
   let row=0;return frame.replace(/<a:tr\b.*?<\/a:tr>/gs,tr=>row++<=rows?tr:'').replace(/(<p:xfrm>.*?<a:ext cx="\d+" cy=")\d+/s,`$1${(44+77*rows)*9525}`);
  });
 }
 return {xml,rels,notes,notesRels};
}
/** All values are local. This function never follows evidence URLs or sends the snapshot to a service. */
export async function createSnapshotPptx(snapshot:ReviewExportSnapshot,options:ReviewExportOptions={}):Promise<ReviewPptxResult>{
 assertXmlSourceText(snapshot);
 const plan=buildReviewDeckPlan(snapshot,options),entries:ZipEntry[]=[];
 const add=(name:string,value:string)=>{
  if(options.fontMode==='arial')value=value.replace(/<a:(rPr|defRPr)([^>]*)>(.*?)<\/a:\1>/gs,(all,tag,attrs,body)=>body.includes('typeface="Red Hat Display Black"')?`<a:${tag}${attrs.replace(/ b="[^"]*"/g,'')} b="1">${body}</a:${tag}>`:all).replace(/typeface="Red Hat (?:Display Black|Text)"/g,'typeface="Arial"');
  entries.push({name,data:encoder.encode(value)});
 };
 for(const [name,part] of Object.entries(TEMPLATE_PARTS)){
  if(/^ppt\/(?:slides|notesSlides)\//.test(name)||['[Content_Types].xml','ppt/presentation.xml','ppt/_rels/presentation.xml.rels','docProps/app.xml','docProps/core.xml'].includes(name))continue;
  entries.push({name,data:part.kind==='text'?encoder.encode(part.value):Uint8Array.from(atob(part.value),c=>c.charCodeAt(0))});
 }
 let types=textPart('[Content_Types].xml').replace(/<Override[^>]*PartName="\/ppt\/(?:slides|notesSlides)\/[^"]+"[^>]*\/>/g,'');
 const ids:string[]=[],slideRels:string[]=[];
 for(let i=0;i<plan.slides.length;i++){
  const index=i+1,{xml,rels,notes,notesRels}=fillSlide(plan.slides[i],index);
  add(`ppt/slides/slide${index}.xml`,xml);add(`ppt/slides/_rels/slide${index}.xml.rels`,rels);
  add(`ppt/notesSlides/notesSlide${index}.xml`,notes);add(`ppt/notesSlides/_rels/notesSlide${index}.xml.rels`,notesRels);
  ids.push(`<p:sldId id="${256+i}" r:id="reviewSlide${index}" xmlns:r="${REL.slice(0,-1)}"/>`);
  slideRels.push(relationship('slide',`/ppt/slides/slide${index}.xml`,`reviewSlide${index}`));
  types=types.replace('</Types>',`<Override PartName="/ppt/slides/slide${index}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/notesSlides/notesSlide${index}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/></Types>`);
 }
 add('[Content_Types].xml',types);
 add('ppt/presentation.xml',textPart('ppt/presentation.xml').replace(/<p:sldIdLst>.*?<\/p:sldIdLst>/s,`<p:sldIdLst>${ids.join('')}</p:sldIdLst>`));
 add('ppt/_rels/presentation.xml.rels',appendRelationships(textPart('ppt/_rels/presentation.xml.rels').replace(/<Relationship[^>]*Type="[^"]+\/slide"[^>]*\/>/g,''),slideRels));
 add('docProps/app.xml',textPart('docProps/app.xml').replace(/<Slides>\d+<\/Slides>/,'<Slides>'+plan.slides.length+'</Slides>'));
 add('docProps/core.xml',`<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escapeXml(snapshot.title)}</dc:title><dc:creator>Impulse 4418</dc:creator><dc:description>Selected Sprint Review snapshot. External decision registers remain authoritative.</dc:description></cp:coreProperties>`);
 const bytes=storeZip(entries);
 // A bounded fresh ArrayBuffer avoids Blob/SharedArrayBuffer incompatibilities in typed browser builds.
 const buffer=new ArrayBuffer(bytes.byteLength);new Uint8Array(buffer).set(bytes);
 const filename=`sprint-review-${snapshot.reviewDate.replace(/[^0-9-]/g,'')||'undated'}.pptx`;
 return {blob:new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.presentationml.presentation'}),filename,slideCount:plan.slides.length,warnings:plan.warnings};
}
export async function createReviewPptx(context:SprintReviewContext,reviewId=context.selected_review_id,options:ReviewExportOptions={}):Promise<ReviewPptxResult>{
 return createSnapshotPptx(createReviewExportSnapshot(context,reviewId),options);
}
