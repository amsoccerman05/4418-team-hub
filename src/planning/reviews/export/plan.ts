import {FONT_METRICS} from './font-metrics.generated';
import {safeReferenceUrl,type ReviewExportSnapshot,type ExportReference,type ExportTask} from './snapshot';
export type DeckLine={text:string;url?:string;label?:boolean};
export type DeckSlide={layout:1|2|3;title:string;slots:Record<string,string>;links:Record<string,string>;notes:string;labels?:string[]};
export type ReviewExportOptions={fontMode?:'reference'|'arial'};
export type ReviewDeckPlan={slides:DeckSlide[];warnings:string[]};
const MAX_SLIDES=500;
export function textWidth(text:string,size=28,family='body'):number {
 return Array.from(text).reduce((width,char)=>width+(FONT_METRICS[family]?.[String(char.codePointAt(0))]??1.2)*size,0);
}
/** Explicit line wrapping at measured font advances. Long words are split, never ellipsized. */
export function wrapText(text:string,width=850,size=28,family='body'):string[] {
 const result:string[]=[];
 for(const paragraph of text.replace(/\r\n?/g,'\n').split('\n')){
  if(!paragraph){result.push('');continue;}
  let line='';
  for(const word of paragraph.split(/(\s+)/u)){
   if(textWidth(line+word,size,family)<=width){line+=word;continue;}
   if(line.trim()){result.push(line.trimEnd());line='';}
   let part='',partWidth=0;
   for(const character of word.trimStart()){
    const advance=(FONT_METRICS[family]?.[String(character.codePointAt(0))]??1.2)*size;
    if(part&&partWidth+advance>width){result.push(part);part='';partWidth=0;}
    part+=character;partWidth+=advance;
   }
   line=part;
  }
  if(line||!result.length)result.push(line.trimEnd());
 }
 return result;
}
export function formatSnapshotTime(value:string):string {const date=new Date(value);return Number.isNaN(date.getTime())?value:new Intl.DateTimeFormat('en-US',{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'UTC',timeZoneName:'short'}).format(date);}
const value=(text:string,cue='Not recorded')=>text.trim()?text:cue;
function field(label:string,text:string,cue?:string):DeckLine[]{return [{text:label,label:true},{text:value(text,cue)}];}
function referenceLines(label:string,refs:ExportReference[]):DeckLine[]{
 if(!refs.length)return field(label,'','No reference provided');
 return [{text:label,label:true},...refs.flatMap(r=>[
  {text:value(r.label,'Untitled reference'),...(r.url&&safeReferenceUrl(r.url)?{url:safeReferenceUrl(r.url)!}:{})},
  {text:`Reference ID: ${value(r.referenceId,'Not supplied')}`},
  ...(r.url&&safeReferenceUrl(r.url)?[]:[{text:r.missingReason??'Link unavailable'}])])];
}
function taskLines(task:ExportTask|null):DeckLine[]{
 if(!task)return field('Next Planning task','','No task linked');
 if(!task.available)return field('Next Planning task','','Linked task unavailable. Open Planning to check access.');
 return [...field('Next Planning task',task.title),...field('Owner',task.owners.join(', '),'Unassigned'),
  ...field('Due date',task.dueDate??'',task.dateUnavailable?'Date unavailable':'No due date'),...field('Status',task.status)];
}
export function buildReviewDeckPlan(snapshot:ReviewExportSnapshot,options:ReviewExportOptions={}):ReviewDeckPlan {
 if(snapshot.schemaVersion!==1)throw new Error('Unsupported review export format.');
 if(JSON.stringify(snapshot).length>2_000_000)throw new Error('This review is too large to export in one file. No content was omitted.');
 const slides:DeckSlide[]=[];
 const widthFactor=options.fontMode==='arial'?0.86:1;
 const provenance=`Review: ${snapshot.title}\nReview date: ${snapshot.reviewDate}\nSnapshot loaded at: ${snapshot.asOf}\nExternal architecture registers remain authoritative. This file records reported information.`;
 const push=(slide:DeckSlide)=>{if(slides.length>=MAX_SLIDES)throw new Error('This review needs more than 500 slides. Reduce the review scope before exporting. No content was omitted.');slides.push(slide);};
 const divider=(lines:string[],caption:string)=>push({layout:1,title:lines.join(' '),slots:{BIG0:lines[0]??'',BIG1:lines[1]??'',BIG2:lines[2]??'',CAPTION:caption},links:{},notes:provenance});
 function content(title:string,lines:DeckLine[]){
  if(!lines.length)lines=[{text:'Not recorded'}];
  const expanded=lines.flatMap(line=>wrapText(line.text,850*widthFactor).map(text=>({...line,text})));
  const groups:DeckLine[][]=[];
  for(const line of expanded){if(line.label||!groups.length)groups.push([]);groups[groups.length-1].push(line);}
  // Keep a field label with its entire value when it fits on a page. Oversized values
  // continue at the same type size. Repeat project context on continuation pages.
  const repeat=groups[0]?.[0]?.text==='Project'&&groups.filter(g=>g[0]?.text==='Project').length===1&&groups[0].length<=3?groups[0]:[];
  let chunk:DeckLine[]=[];
  function flush(){
   if(!chunk.length)return;
   const slots:Record<string,string>={TITLE:title},links:Record<string,string>={},labels:string[]=[];
   for(let j=0;j<10;j++){slots[`LINE${j}`]=chunk[j]?.text??'';if(chunk[j]?.url)links[`LINE${j}`]=chunk[j].url!;if(chunk[j]?.label)labels.push(`LINE${j}`);}
   push({layout:2,title,slots,links,labels,notes:provenance+'\n'+chunk.map(l=>l.text+(l.url?'\n'+l.url:'')).join('\n')});
   chunk=[];
  }
  for(const group of groups){
   const capacity=10-repeat.length;
   if(group.length<=capacity&&chunk.length+group.length>10){flush();chunk=[...repeat];}
   for(let i=0;i<group.length;i++){
    if(chunk.length===10){flush();chunk=[...repeat];}
    // A trailing label begins the next page with its value.
    if(group[i].label&&chunk.length===9&&i+1<group.length){flush();chunk=[...repeat];}
    chunk.push(group[i]);
   }
  }
  flush();
 }
 divider(['Sprint','Review'],snapshot.reviewDate);
 content('Review details',[...field('Meeting',snapshot.title),...field('Season',snapshot.season),...field('Review date',snapshot.reviewDate),...field('Chair',snapshot.chair??'','Not assigned'),...field('Planning snapshot',formatSnapshotTime(snapshot.asOf))]);
 if(!snapshot.agenda.length)content('Agenda',field('Meeting agenda','','No agenda recorded'));
 else {
  const rows:string[][][]=[];
  for(const item of snapshot.agenda){
   const columns=[wrapText(value(item.title,'Untitled agenda item'),454*widthFactor,24),wrapText(item.presenter??'Presenter not assigned',236*widthFactor,24),wrapText(Number.isFinite(item.minutes)?String(item.minutes):'Unavailable',106*widthFactor,24)];
   const pages=Math.max(...columns.map(c=>Math.ceil(c.length/2)));
   for(let i=0;i<pages;i++)rows.push(columns.map(c=>c.slice(i*2,i*2+2)));
  }
  const total=snapshot.agenda.reduce((n,a)=>n+(Number.isFinite(a.minutes)?a.minutes:0),0);
  for(let i=0;i<rows.length;i+=4){const slots:Record<string,string>={TITLE:`Agenda (${total} min)`,ROW_COUNT:String(Math.min(4,rows.length-i))};for(let r=0;r<4;r++)for(let c=0;c<3;c++)for(let k=0;k<2;k++)slots[`R${r}C${c}${k?'B':'A'}`]=rows[i+r]?.[c]?.[k]??'';
   push({layout:3,title:'Agenda',slots,links:{},notes:provenance+'\n'+snapshot.agenda.map(a=>`${a.title}; presenter: ${a.presenter??'Not assigned'}; duration: ${a.minutes} minutes`).join('\n')});}
 }
 divider(['Project','Updates'],'');
 if(!snapshot.projects.length)content('Project updates',field('Projects','','No project records available'));
 for(const project of snapshot.projects){
  const u=project.update,projectLine=()=>field('Project',project.name);
  content('Progress and blockers',[...projectLine(),...field('Student lead',project.lead??'','Not assigned'),...field('Supporters',project.supporters.join(', '),'Not assigned'),...field('Progress',u?.progress??'','No update recorded'),...field('Blockers',u?.blockers??'','No blockers recorded')]);
  content('Evidence and tradeoffs',[...projectLine(),...referenceLines('Evidence and demonstration',u?.evidence??[]),...field('Images','','No image attached to this review. Evidence links open the original source.'),...field('Tradeoffs',u?.tradeoffs??'')]);
  content('Reported decisions',[...projectLine(),...field('Decision needed',u?.decisionsNeeded??''),...field('Reported decision',u?.reportedDecision??'','No decision reported'),...field('Rationale',u?.decisionRationale??''),...field('Reported student participants',u?.reportedBy.join(', ')??'','No student participants recorded'),...referenceLines('External decision register',u?.decisionReferences??[])]);
  content('Next steps',[...projectLine(),...field('Next test',u?.nextTest??''),...taskLines(u?.nextTask??null),...field('Carry-forward status',u?u.unresolved?'Unresolved':'Not marked unresolved':'No update recorded'),...(u?.carriedFrom?field('Carried from',`${u.carriedFrom.reviewTitle} (${u.carriedFrom.reviewDate})`):[])]);
 }
 const unresolved=snapshot.projects.filter(p=>p.update?.unresolved);
 content('Unresolved carry-forward',[
  ...unresolved.flatMap(p=>[...field('Project',p.name),...field('Blockers',p.update!.blockers),...field('Decision needed',p.update!.decisionsNeeded)]),
  ...snapshot.priorUnresolved.flatMap(p=>[...field('Prior unresolved project',p.project),...field('Previous review',`${p.reviewTitle} (${p.reviewDate})`),...field('Blockers',p.blockers),...field('Decision needed',p.decisionsNeeded),...field('Next test',p.nextTest)]),
  ...(!unresolved.length&&!snapshot.priorUnresolved.length?field('Carry-forward','','No unresolved items recorded'):[])]);
 divider(['Next','Sprint'],'');
 content('Next sprint',snapshot.projects.flatMap(p=>[...field('Project',p.name),...field('Next test',p.update?.nextTest??''),...taskLines(p.update?.nextTask??null)]));
 slides.forEach((slide,index)=>slide.slots.PAGE=String(index+1));
 return {slides,warnings:[options.fontMode==='arial'?'Arial compatibility layout selected. Typography differs from the reference.':'Fonts are not embedded. Install Red Hat Display Black and Red Hat Text for the closest match to the reference.','No evidence images are fetched or embedded automatically. Open the source hyperlinks to view them.']};
}
