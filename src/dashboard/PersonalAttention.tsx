import {AlertCircle,ArrowRight} from 'lucide-react';
import type {AssignmentSource,PersonalAttention} from './personal-attention';
export type AttentionAction = {href:string;text:string};
function Source({name,source,href,previewLabel}:{name:string;source:AssignmentSource;href:string;previewLabel:string}) {
 if(source.status==='loading')return <p className="my-assignment-state" role="status">Checking your {name.toLowerCase()}…</p>;
 if(source.status==='error')return <p className="my-assignment-state">Your {name.toLowerCase()} couldn’t be checked. Refresh to try again, or <a href={href}>open {name==='Planning tasks'?'My Work':'Pit'}</a>.</p>;
 if(!source.data.total)return null;
 return <div className="my-assignment-source"><h3>{name}<span>{source.data.total} open</span></h3><ul>{source.data.items.map(item=><li key={item.id}><a href={item.href}><span><strong>{item.title}</strong><small className={item.urgent?'is-urgent':''}>{item.detail}</small></span><ArrowRight size={17} aria-hidden="true"/></a></li>)}</ul>{source.data.total>source.data.items.length&&<p className="my-assignment-more">{previewLabel} {source.data.items.length} of {source.data.total}. <a href={href}>View {name==='Planning tasks'?'My Work':'Pit repairs'}</a></p>}</div>;
}
export function PersonalAttentionPanel({actions,assignments}:{actions:AttentionAction[];assignments:PersonalAttention}) {
 const hasAssignments=Object.values(assignments).some(s=>s.status!=='ready'||s.data.total>0);
 if(!actions.length&&!hasAssignments)return null;
 return <section className="my-attention" aria-labelledby="attention-heading"><h2 id="attention-heading"><AlertCircle size={19} aria-hidden="true"/>Needs your attention</h2>{actions.length>0&&<ul>{actions.map(a=><li key={a.text}><a href={a.href}>{a.text}<ArrowRight size={17} aria-hidden="true"/></a></li>)}</ul>}<Source name="Planning tasks" source={assignments.planning} href="#planning/my-work" previewLabel="Showing"/><Source name="Pit repairs" source={assignments.pit} href="https://pit.frc4418.org/" previewLabel="Most recently updated:"/></section>;
}
