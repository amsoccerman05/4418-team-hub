import {supabase} from '../attendance/service';
export type Announcement={id:string;title:string;body:string;severity:'normal'|'important'|'urgent';created_at:string;expires_at:string|null;active?:boolean;area_id?:string|null;version?:number;audience?:string;position_key?:string|null;image_path?:string|null};
export type Dashboard={name:string;role:string;admin:boolean;personal:{percent:number|null;strikes:number;pending:number};next_meeting:null|{id:string;title:string;type:string;starts_at:string;ends_at:string;required:boolean;check_in_open:boolean;code_expires_at:string|null;physical_status:string};orders:{id:string;po_number:number;vendor:string;amount:number;status:string;approvals:number}[];finance:{allowed:boolean;approvals:number;school:number};attention:null|{open_meetings:number;requests:number;strike_actions:number};robot:null|{event:string;open:number;blocking:number;readiness:string};inventory:null|{out:number;low:number};announcements:Announcement[]};
export async function context():Promise<Dashboard>{
 const {data,error}=await supabase!.rpc('team_dashboard_context').abortSignal(AbortSignal.timeout(15000));
 if(error)throw error;
 if(!data?.personal||!Array.isArray(data.orders))throw new Error('Dashboard is unavailable. Please try again.');
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
