import type {ReactNode} from 'react';
export function ContextActions({label,children}:{label:string;children:ReactNode}){
 return <details className="planning-context-actions" onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.currentTarget.open=false;e.currentTarget.querySelector('summary')?.focus();}}} onClick={e=>{if((e.target as HTMLElement).closest('button'))e.currentTarget.open=false;}}><summary aria-label={label}>•••</summary><div>{children}</div></details>;
}
