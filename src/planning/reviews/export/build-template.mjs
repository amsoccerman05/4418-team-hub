/** Private authoring only. Never imported by the app. Requires the supplied artifact runtime.
 * Pass SR_EXPORT_BUILD_DIR containing the separately reviewed brand PNGs and full font files.
 * Template regeneration requires visual review before replacing template.generated.ts. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const build = process.env.SR_EXPORT_BUILD_DIR;
const runtime = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
if(!path.isAbsolute(build ?? '') || !path.isAbsolute(runtime ?? '')) throw new Error('Absolute build/runtime directories required');
const require = createRequire(path.join(runtime,'runtime-loader.cjs'));
const {Presentation,PresentationFile}=require('@oai/artifact-tool');
const {GlobalFonts}=require('@napi-rs/canvas');
const artifactRequire=createRequire(require.resolve('@oai/artifact-tool'));
const {FontLibrary}=artifactRequire('skia-canvas');
FontLibrary.use('Red Hat Display Black',path.join(build,'fonts/RedHatDisplay-Black-full.ttf'));
FontLibrary.use('Red Hat Text',path.join(build,'fonts/RedHatText-Regular-full.ttf'));
GlobalFonts.registerFromPath(path.join(build,'RedHatDisplay-Black-full.ttf'),'Red Hat Display Black');
GlobalFonts.registerFromPath(path.join(build,'RedHatText-Regular-full.ttf'),'Red Hat Text');
const presentation=Presentation.create({slideSize:{width:960,height:540}});
const bg=await fs.readFile(path.join(build,'brand-background.png'));
const logo=await fs.readFile(path.join(build,'impulse-logo.png'));
const YELLOW='#F1C232',WHITE='#FFFFFF';
function txt(slide,name,value,x,y,w,h,font=28,color=WHITE,face='Red Hat Text'){
 const shape=slide.shapes.add({geometry:'textbox',name,position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
 shape.text=value;shape.text.style={typeface:face,fontSize:font,color,autoFit:'none',wrap:'none',insets:{left:0,right:0,top:0,bottom:0}};return shape;
}
function base(largeLogo=false){
 const s=presentation.slides.add();
 s.images.add({blob:bg,contentType:'image/png',alt:'Impulse blue band background',position:{left:0,top:0,width:960,height:540}});
 const w=largeLogo?148:84;
 s.images.add({blob:logo,contentType:'image/png',alt:'Impulse 4418 rocket logo',fit:'contain',position:{left:960-w-4,top:4,width:w,height:w*1223/2048}});
 txt(s,'page','{{PAGE}}',892,510,48,23,17.33);s.speakerNotes.textFrame.setText('{{NOTES}}');return s;
}
function heading(s){txt(s,'title','{{TITLE}}',36,28,830,72,52,YELLOW,'Red Hat Display Black');}
const cover=base(true);
for(let i=0;i<3;i++){
 txt(cover,'cover-shadow-'+i,`{{BIG${i}}}`,52,92+i*126,850,140,120,'#FF0000','Red Hat Display Black');
 txt(cover,'cover-'+i,`{{BIG${i}}}`,44,86+i*126,850,140,120,YELLOW,'Red Hat Display Black');
}
txt(cover,'cover-caption','{{CAPTION}}',44,476,838,31,24);
const content=base();heading(content);
for(let i=0;i<10;i++)txt(content,'line-'+i,`{{LINE${i}}}`,44,118+i*36,868,36,28);
const tableSlide=base();heading(tableSlide);
const values=[['Agenda item','Presenter','Minutes'],...Array.from({length:4},(_,r)=>Array.from({length:3},(_,c)=>`{{R${r}C${c}A}}\n{{R${r}C${c}B}}`))];
const table=tableSlide.tables.add({rows:5,columns:3,left:44,top:130,width:868,height:352,columnWidths:[478,260,130],values});
table.borders.assign({fill:'#7491BA',width:0.7});
table.cells.block({row:0,column:0,rowCount:5,columnCount:3}).assign({fill:'none',textStyle:{typeface:'Red Hat Text',fontSize:24,color:WHITE},margins:{left:8,right:8,top:8,bottom:8},anchor:'center'});
table.cells.block({row:0,column:0,rowCount:1,columnCount:3}).assign({fill:YELLOW,textStyle:{typeface:'Red Hat Display Black',fontSize:24,color:'#01135D'}});
table.rows[0].height=44;for(let i=1;i<5;i++)table.rows[i].height=77;
const imageSlide=base();heading(imageSlide);
txt(imageSlide,'image-caption','{{IMAGE_CAPTION}}',44,110,868,38,28);
imageSlide.images.add({blob:logo,contentType:'image/png',alt:'User-provided evidence image placeholder',fit:'contain',position:{left:44,top:160,width:868,height:304}});
txt(imageSlide,'image-source','{{IMAGE_SOURCE}}',44,474,868,32,24);
await (await PresentationFile.exportPptx(presentation)).save(path.join(build,'authored-template.pptx'));
for(let i=0;i<presentation.slides.items.length;i++){
 const slide=presentation.slides.items[i];
 await fs.writeFile(path.join(build,`template-${i+1}.png`),new Uint8Array(await (await presentation.export({slide,format:'png',scale:1})).arrayBuffer()));
}
console.log('Authored four editable template layouts with artifact-tool.');
