import {supabase,syncMyMeetingRosters} from '../attendance/service';
import {attendanceMeetingId} from '../attendance/meeting-route';
import {currentCheckoutMeeting,currentPendingMeeting,attendancePresence} from './next-meeting';
export type Announcement={id:string;title:string;body:string;severity:'normal'|'important'|'urgent';created_at:string;expires_at:string|null;active?:boolean;area_id?:string|null;version?:number;audience?:string;position_key?:string|null;image_path?:string|null};
export type Dashboard={name:string;role:string;admin:boolean;personal:{percent:number|null;strikes:number;pending:number};next_meeting:null|{id:string;title:string;type:string;starts_at:string;ends_at:string;required:boolean;check_in_open:boolean;code_expires_at:string|null;physical_status:string;checked_in_at?:string|null;left_at?:string|null};orders:{id:string;po_number:number;vendor:string;amount:number;status:string;approvals:number}[];finance:{allowed:boolean;approvals:number;school:number};attention:null|{open_meetings:number;requests:number;strike_actions:number};robot:null|{event:string;open:number;blocking:number;readiness:string};inventory:null|{out:number;low:number};announcements:Announcement[]};
export async function context(userId:string):Promise<Dashboard>{
 await syncMyMeetingRosters();
 const signal=AbortSignal.timeout(15000),now=Date.now();
 const {data,error}=await supabase!.rpc('team_dashboard_context').abortSignal(signal);
 if(error)throw error;
 if(!data?.personal||!Array.isArray(data.orders))throw new Error('Dashboard is unavailable. Please try again.');
 if(!['student','lead','admin_lead','mentor','admin'].includes(data.role))return data;
 // The existing dashboard RPC omits departure timestamps and ended meetings.
 // Read only RLS-visible current meetings and the caller's own attendance so the
 // existing 30-minute checkout grace remains reachable from Home. No writes.
 type CurrentMeeting={id:string;title:string;status:string;meeting_type:string;starts_at:string;ends_at:string;check_in_open:boolean;code_expires_at:string|null};
 const current:CurrentMeeting[]=[];
 for(let from=0;;from+=500){
  const result=await supabase!.from('team_meetings').select('id,title,status,meeting_type,starts_at,ends_at,check_in_open,code_expires_at')
   .lte('starts_at',new Date(now).toISOString()).gt('ends_at',new Date(now-30*60_000).toISOString())
   .in('status',['draft','open','closed','finalized']).order('id').range(from,from+499).abortSignal(signal);
  if(result.error)throw result.error;
  current.push(...result.data);if(result.data.length<500)break;
 }
 const next=data.next_meeting as Dashboard['next_meeting'];
 const ids=[...new Set([...current.map(m=>m.id),...(next&&attendanceMeetingId(`#attendance/meeting/${next.id}`)?[next.id]:[])])];
 type OwnAttendance={meeting_id:string;physical_status:string;checked_in_at:string|null;left_at:string|null};
 const records:OwnAttendance[]=[];
 for(let from=0;from<ids.length;from+=100){
  const result=await supabase!.from('team_attendance').select('meeting_id,physical_status,checked_in_at,left_at')
   .eq('student_id',userId).in('meeting_id',ids.slice(from,from+100)).abortSignal(signal);
  if(result.error)throw result.error;records.push(...result.data);
 }
 const checkout=currentCheckoutMeeting(current,records,now);
 // Keep checkout and an existing ongoing required meeting ahead of an optional
 // fallback. Only the caller's own attendance and roster can supply this card.
 const active=checkout||((!next||Date.parse(next.starts_at)>now)?currentPendingMeeting(current,records,now):undefined);
 let currentShown=false;
 if(active){
  const own=records.find(a=>a.meeting_id===active.id)!;
  const snapshot=await supabase!.from('team_meeting_members').select('required').eq('meeting_id',active.id).eq('student_id',userId).abortSignal(signal).maybeSingle();
  if(snapshot.error)throw snapshot.error;
  if(snapshot.data){data.next_meeting={...active,type:active.meeting_type,required:!!snapshot.data.required,...attendancePresence(own)};currentShown=true;}
 }
 if(!currentShown&&next&&attendanceMeetingId(`#attendance/meeting/${next.id}`)){
  const own=records.find(a=>a.meeting_id===next.id);
  data.next_meeting=own?{...next,...attendancePresence(own)}:null;
 }
 return data;
}
export async function announcementData(){
 const [a,b,c]=await Promise.all([supabase!.from('team_announcements').select('*').order('created_at',{ascending:false}).abortSignal(AbortSignal.timeout(15000)),supabase!.from('areas').select('id,name,active').eq('active',true).abortSignal(AbortSignal.timeout(15000)),supabase!.from('team_positions').select('key,name').eq('active',true).abortSignal(AbortSignal.timeout(15000))]);
 if(a.error)throw a.error;if(b.error)throw b.error;if(c.error)throw c.error;
 return {announcements:a.data as Announcement[],areas:b.data as {id:string;name:string}[],positions:c.data as {key:string;name:string}[]};
}
export async function saveAnnouncement(p:Record<string,unknown>){const r=await supabase!.rpc('team_announcement_save',{p}).abortSignal(AbortSignal.timeout(15000));if(r.error)throw r.error;}

export const mediaBucket='team-announcement-media';
export async function uploadImage(file:File){
 if(file.size>6*1024*1024)throw new Error('Choose an image no larger than 6 MB.');
 const b=new Uint8Array(await file.slice(0,12).arrayBuffer());
 const jpeg=b[0]===255&&b[1]===216&&b[2]===255;
 const png=[137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v);
 const webp=String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP';
 if(!((file.type==='image/jpeg'&&jpeg)||(file.type==='image/png'&&png)||(file.type==='image/webp'&&webp)))throw new Error('Choose a JPG, PNG, or WebP image.');
 const {data,error}=await supabase!.auth.getSession();if(error)throw error;if(!data.session)throw new Error('Sign in before uploading.');
 const path=`${data.session.user.id}/${crypto.randomUUID()}.${file.type==='image/jpeg'?'jpg':file.type.split('/')[1]}`;
 const r=await supabase!.storage.from(mediaBucket).upload(path,file,{contentType:file.type,upsert:false});if(r.error)throw r.error;return path;
}
export async function removeImage(path:string){const r=await supabase!.storage.from(mediaBucket).remove([path]);if(r.error)throw r.error;}
export async function sendAnnouncementUpdate(a:Announcement,request_id:string){const r=await supabase!.rpc('team_announcement_send_update',{announcement_id:a.id,expected_version:a.version,request_id}).abortSignal(AbortSignal.timeout(15000));if(r.error)throw r.error;}

