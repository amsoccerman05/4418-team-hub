import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {AlertTriangle,FileUp,X} from 'lucide-react';
import {validateFabricationSubmission} from './model';
import {FABRICATION_DXF_MAX_BYTES,FABRICATION_PDF_MAX_BYTES,type FabricationPart,type FabricationProject,type FabricationSubmission} from './types';

export function FabricationDialog({title,eyebrow,onClose,children}:{title:string;eyebrow?:string;onClose:()=>void;children:ReactNode}){
 const ref=useRef<HTMLDialogElement>(null),id=useId();
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null,dialog=ref.current;dialog?.showModal();return()=>{dialog?.close();if(previous?.isConnected)previous.focus();};},[]);
 return <dialog ref={ref} className="fab-dialog" aria-labelledby={id} onCancel={e=>{e.preventDefault();onClose();}}><header><h2 id={id}>{eyebrow&&<span>{eyebrow}</span>}{title}</h2><button className="fab-icon-button" type="button" onClick={onClose} aria-label="Close part dialog"><X size={19}/></button></header>{children}</dialog>;
}
export function revisionIssue(p:FabricationSubmission,dxf:File|null,pdf:File|null):string|null{
 const metadataIssue=validateFabricationSubmission(p);if(metadataIssue)return metadataIssue;
 for(const file of [dxf,pdf])if(file&&(file.name.length>120||!/[A-Za-z0-9]/.test(file.name[0]||'')||!/^[A-Za-z0-9][A-Za-z0-9 _().-]*$/.test(file.name)||file.name.includes('..')||/\.(exe|com|bat|cmd|js|html|htm|svg|zip|scr|dll|sh)\./i.test(file.name)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(file.name)))return 'Use simple filenames with letters, numbers, spaces, underscores, hyphens, or parentheses, up to 120 characters.';
 if(!dxf)return 'Choose a DXF file for this revision.';
 if(!/\.dxf$/i.test(dxf.name)||!dxf.size||dxf.size>FABRICATION_DXF_MAX_BYTES)return `Choose a nonempty DXF file no larger than ${FABRICATION_DXF_MAX_BYTES/1024/1024} MB.`;
 if(pdf&&(!/\.pdf$/i.test(pdf.name)||!pdf.size||pdf.size>FABRICATION_PDF_MAX_BYTES))return `Choose a nonempty PDF file no larger than ${FABRICATION_PDF_MAX_BYTES/1024/1024} MB.`;
 return null;
}
export function RevisionEditor({project,part,busy,error,onClose,onSave}:{project:FabricationProject;part:FabricationPart|null;busy:boolean;error:string;onClose:()=>void;onSave:(p:FabricationSubmission,dxf:File,pdf:File|null)=>void}){
 const id=useId();
 const [draft,setDraft]=useState<FabricationSubmission>(()=>({part_id:part?.id||crypto.randomUUID(),board_id:project.id,version:part?.version??null,revision_id:crypto.randomUUID(),name:part?.current_revision.name||'',material:part?.current_revision.material||'',thickness:part?.current_revision.thickness||0,thickness_unit:part?.current_revision.thickness_unit||'mm',drawing_unit:part?.current_revision.drawing_unit||'mm',quantity:part?.current_revision.quantity||1,needed_date:part?.current_revision.needed_date||'',onshape_url:part?.current_revision.onshape_url||'',notes:''}));
 const [dxf,setDxf]=useState<File|null>(null),[pdf,setPdf]=useState<File|null>(null),[validation,setValidation]=useState(''),[understood,setUnderstood]=useState(false),[unitsConfirmed,setUnitsConfirmed]=useState(false);
 const change=<K extends keyof FabricationSubmission>(key:K,value:FabricationSubmission[K])=>setDraft(d=>({...d,[key]:value}));
 const hasClaim=!!part?.claimed_by||part?.status==='in_progress',nextRevision=(part?.current_revision.revision_number||0)+1;
 function submit(){if(busy)return;const issue=revisionIssue(draft,dxf,pdf);if(issue){setValidation(issue);return;}if(!unitsConfirmed){setValidation('Choose the DXF drawing units for the file you selected.');return;}if(hasClaim&&!understood){setValidation('Confirm that the current operator must review and acknowledge the new revision.');return;}setValidation('');onSave({...draft,name:draft.name.trim(),material:draft.material.trim(),onshape_url:draft.onshape_url.trim(),notes:draft.notes.trim()},dxf!,pdf);}
 return <FabricationDialog title={part?'Submit new revision':'Add a fabrication part'} eyebrow={project.name} onClose={onClose}>
 <p className="fab-dialog-intro">{part?`Revision ${nextRevision} becomes the current revision. Earlier files and specifications stay in the history.`:'Add each physical part separately. Related parts stay together under this Planning project.'}</p>
 <form noValidate onSubmit={e=>{e.preventDefault();submit();}}>
 {(validation||error)&&<p role="alert" className="fab-error">{validation||error}</p>}
 <fieldset className="fab-form-fields" disabled={busy}>
 {hasClaim&&<div className="fab-warning"><strong><AlertTriangle size={14}/> This part is claimed{part?.status==='in_progress'?' and work is in progress':''}</strong>The operator keeps the claim. This revision returns the part to Needs review and clears the previous review and acknowledgement. Work must wait for the latest revision.<label className="fab-check"><input type="checkbox" checked={understood} onChange={e=>setUnderstood(e.target.checked)}/>I understand the operator must review and acknowledge this revision.</label></div>}
 <div className="fab-form-grid">
 <label className="fab-wide" htmlFor={`${id}-name`}>Part name<input id={`${id}-name`} autoFocus maxLength={200} required value={draft.name} onChange={e=>change('name',e.target.value)} placeholder="e.g. Intake side plate, left"/></label>
 <label htmlFor={`${id}-material`}>Material<input id={`${id}-material`} required maxLength={120} value={draft.material} onChange={e=>change('material',e.target.value)} placeholder="e.g. 6061-T6 aluminum"/></label>
 <div className="fab-field"><label htmlFor={`${id}-thickness`}>Material thickness</label><div className="fab-unit-input"><input id={`${id}-thickness`} required type="number" min="0.0001" max={1000} step="any" value={draft.thickness||''} onChange={e=>change('thickness',Number(e.target.value))} placeholder="0"/><select aria-label="Thickness units" value={draft.thickness_unit} onChange={e=>change('thickness_unit',e.target.value as 'mm'|'in')}><option value="mm">mm</option><option value="in">in</option></select></div></div>
 <label htmlFor={`${id}-quantity`}>Quantity<input id={`${id}-quantity`} required type="number" min={1} max={100000} step={1} value={draft.quantity||''} onChange={e=>change('quantity',Number(e.target.value))}/></label>
 <label htmlFor={`${id}-date`}>Needed by<input id={`${id}-date`} required type="date" value={draft.needed_date} onChange={e=>change('needed_date',e.target.value)}/></label>
 <label className="fab-wide" htmlFor={`${id}-onshape`}>Onshape document link <small>Optional · Link to the source design, including its version or workspace.</small><input id={`${id}-onshape`} type="url" maxLength={2000} value={draft.onshape_url} onChange={e=>change('onshape_url',e.target.value)} placeholder="https://cad.onshape.com/documents/…"/></label>
 </div>
 <div className="fab-section-title"><h3>Revision {nextRevision} files</h3><span>Private team downloads</span></div>
 <div className="fab-form-grid">
 <div className="fab-upload"><label htmlFor={`${id}-dxf`}><FileUp size={15}/> DXF drawing · required</label><input id={`${id}-dxf`} required type="file" accept=".dxf" onChange={e=>{setDxf(e.target.files?.[0]||null);setUnitsConfirmed(false);}}/><small>ASCII DXF · up to {FABRICATION_DXF_MAX_BYTES/1024/1024} MB{part?' · Choose a fresh file for this revision.':''} Use a simple filename up to 120 characters.</small></div>
 <div className="fab-upload"><label htmlFor={`${id}-pdf`}>PDF reference · optional</label><input id={`${id}-pdf`} type="file" accept=".pdf,application/pdf" onChange={e=>setPdf(e.target.files?.[0]||null)}/><small>Up to {FABRICATION_PDF_MAX_BYTES/1024/1024} MB. {part?'Earlier PDFs are not copied to this revision.':'Use for dimensions, tolerances, or assembly context.'}</small></div>
 <div className="fab-field"><label htmlFor={`${id}-drawing-unit`}>DXF drawing units</label><select id={`${id}-drawing-unit`} aria-describedby={`${id}-drawing-help`} required value={unitsConfirmed?draft.drawing_unit:''} onChange={e=>{change('drawing_unit',e.target.value as 'mm'|'in');setUnitsConfirmed(!!e.target.value);}}><option value="" disabled>Choose DXF units</option><option value="mm">Millimeters (mm)</option><option value="in">Inches (in)</option></select><small id={`${id}-drawing-help`} className="fab-caption">Confirm this export's units. Choose them again whenever you select a different DXF.</small></div>
 <label className="fab-wide" htmlFor={`${id}-notes`}>{part?'What changed in this revision?':'Fabrication notes'}<textarea id={`${id}-notes`} maxLength={2000} rows={3} value={draft.notes} onChange={e=>change('notes',e.target.value)} placeholder={part?'Describe the change so the operator knows what to review.':'Critical dimensions, finish, orientation, or other context…'}/></label>
 </div>
 </fieldset>
 <div className="fab-dialog-footer"><button type="button" onClick={onClose}>Cancel</button><button type="submit" className="fab-primary" disabled={busy}>{busy?'Submitting revision…':part?'Submit new revision':'Submit part for review'}</button>{busy&&<small role="status">You can close this editor. If the response is interrupted, check the save status before submitting again.</small>}</div>
 </form>
 </FabricationDialog>;
}
