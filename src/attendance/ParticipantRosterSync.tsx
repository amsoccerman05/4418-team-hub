import { useState, type FormEvent } from "react";
import { rpc, rosterSyncMeetings, type Data, type Member } from "./service";
type Run = (work: () => Promise<unknown>, success?: string) => Promise<void>;

export function ParticipantRosterSync({data,member,run}:{data:Data;member:Member;run:Run}) {
  const meetings=rosterSyncMeetings(data,member);
  const [selected,setSelected]=useState<string[]>(()=>meetings.map(m=>m.id));
  const [result,setResult]=useState("");
  const ids=meetings.filter(m=>selected.includes(m.id)).map(m=>m.id);
  function submit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Recheck the time at submission; the RPC independently validates every ID.
    const currentIds=rosterSyncMeetings(data,member).filter(m=>selected.includes(m.id)).map(m=>m.id);
    void run(async()=>{
      if(!currentIds.length||currentIds.length>52)throw new Error("Choose 1–52 eligible future meetings.");
      const outcome=await rpc("team_attendance_sync_participant_rosters",{student_id:member.student_id,meeting_ids:currentIds}) as {added:number;promoted:number;skipped:number};
      setResult(`Added ${outcome.added}; newly required ${outcome.promoted}; preserved for review ${outcome.skipped}.`);
      setSelected([]);
    },"Selected future rosters synced");
  }
  return <details className="att-panel att-roster-tools">
    <summary>Sync this member’s future meetings</summary>
    <section aria-label={`Roster sync for ${member.display_name}`}>
      <p>Only {member.display_name} is updated, in the meetings selected below. Other members and past meetings stay unchanged.</p>
      <p>Registered-member meetings are available only when this member is enrolled as Registered in Attendance. This does not confirm FIRST registration or school forms.</p>
      {!meetings.length?<p>No eligible future active-member or registered-member meetings. Check this member’s Attendance enrollment.</p>:<form className="att-form" onSubmit={submit}>
        <fieldset><legend>Future meetings for {member.display_name}</legend>
          {meetings.map(m=><label className="att-check" key={m.id}>
            <input type="checkbox" value={m.id} checked={ids.includes(m.id)} onChange={e=>{setResult("");setSelected(previous=>e.target.checked?[...previous.filter(id=>id!==m.id),m.id]:previous.filter(id=>id!==m.id));}}/>
            {m.title} · {new Date(m.starts_at).toLocaleString([], {dateStyle:"medium",timeStyle:"short"})}
          </label>)}
        </fieldset>
        <p>{ids.length} selected. Existing attendance decisions are preserved.</p>
        <button disabled={!ids.length||ids.length>52}>Sync selected meetings</button>
        {ids.length>52&&<p>Choose no more than 52 meetings at once.</p>}
      </form>}
      {result&&<p>{result}</p>}
    </section>
  </details>;
}
