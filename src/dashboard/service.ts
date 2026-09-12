import {supabase} from '../attendance/service';
export type Announcement={id:string;title:string;body:string;severity:'normal'|'important'|'urgent';created_at:string;expires_at:string|null;active?:boolean;area_id?:string|null;version?:number};
export type Dashboard={name:string;role:string;admin:boolean;personal:{percent:number|null;strikes:number;pending:number};next_meeting:null|{id:string;title:string;type:string;starts_at:string;ends_at:string;required:boolean;check_in_open:boolean;code_expires_at:string|null;physical_status:string};orders:{id:string;po_number:number;vendor:string;amount:number;status:string;approvals:number}[];finance:{allowed:boolean;approvals:number;school:number};attention:null|{open_meetings:number;requests:number;strike_actions:number};robot:null|{event:string;open:number;blocking:number;readiness:string};inventory:null|{out:number;low:number};announcements:Announcement[]};
export async function context():Promise<Dashboard>{
 const {data,error}=await supabase!.rpc('team_dashboard_context').abortSignal(AbortSignal.timeout(15000));
 if(error)throw error;
 if(!data?.personal||!Array.isArray(data.orders))throw new Error('Dashboard is unavailable. Please try again.');
 return data;
}
export async function announcementData(){
 const [a,b]=await Promise.all([supabase!.from('team_announcements').select('*').order('created_at',{ascending:false}).abortSignal(AbortSignal.timeout(15000)),supabase!.from('areas').select('id,name,active').eq('active',true).abortSignal(AbortSignal.timeout(15000))]);
 if(a.error)throw a.error;if(b.error)throw b.error;
 return {announcements:a.data as Announcement[],areas:b.data as {id:string;name:string}[]};
}
export async function saveAnnouncement(p:Record<string,unknown>){const r=await supabase!.rpc('team_announcement_save',{p}).abortSignal(AbortSignal.timeout(15000));if(r.error)throw r.error;}
