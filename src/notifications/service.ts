import {supabase} from '../attendance/service';
export type Notice={id:string;source:'finance'|'attendance'|'announcements';title:string;message:string;created_at:string;read_at:string|null;href:string;action_needed:boolean};
export type Filter='all'|'unread'|'action';
export type Center={unread:number;attention:Notice[];items:Notice[];has_more:boolean};
export async function fetchNotifications(filter:Filter='all',cursor?:Notice):Promise<Center>{
 const {data,error}=await supabase!.rpc('notification_center',{filter,before_at:cursor?.created_at??null,before_id:cursor?.id??null}).abortSignal(AbortSignal.timeout(15000));
 if(error)throw error;if(!data||!Array.isArray(data.items)||!Array.isArray(data.attention))throw new Error('Notifications are unavailable. Try again.');return data;
}
export async function setRead(id:string|null,unread=false){const {error}=await supabase!.rpc('notification_read',{notification_id:id,unread}).abortSignal(AbortSignal.timeout(15000));if(error)throw error;}
// Defense in depth: only the known domain routes from the safe RPC are links.
export function safeTarget(href:string){return /^https:\/\/finance\.frc4418\.org\/#po\/[0-9a-f-]{36}$/.test(href)||['#attendance/notices','#attendance/strikes','#home-announcements'].includes(href)?href:'#notifications';}
