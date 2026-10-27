import {ArrowRight,ClipboardList,Search,ShoppingCart,Wrench} from 'lucide-react';
import {homeTasks} from '../links';

const icons=[Search,ShoppingCart,Wrench,ClipboardList];
export function HomeTasks(){
 return <nav className="my-task-shortcuts" aria-label="Start a task">
  {homeTasks.map((task,index)=>{const Icon=icons[index];return <a key={task.id} href={task.url} aria-labelledby={`task-${task.id}`} aria-describedby={`task-${task.id}-description`}>
   <Icon size={20} aria-hidden="true"/>
   <span><strong id={`task-${task.id}`}>{task.name}</strong><small id={`task-${task.id}-description`}>{task.description}</small></span>
   <ArrowRight size={16} aria-hidden="true"/>
  </a>;})}
 </nav>;
}
