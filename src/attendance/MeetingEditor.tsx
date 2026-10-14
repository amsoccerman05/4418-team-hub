import { useRef, useState, type FormEvent } from "react";
import { rpc, type Data, type Meeting } from "./service";
import { bulkRequiredSelection, localMeetingTime, localTimeChoices, meetingLockReason, meetingRosterOptions, offsetLabel,
  requiredRosterChanges, requiredStudentIds, resolveMeetingTime, rosterEditFields, scheduleLockReason } from "./meetingEdit";

type Run = (work: () => Promise<unknown>, success?: string, afterRefresh?: () => void) => Promise<void>;
const when = (value: string) => new Date(value).toLocaleString([], {dateStyle: "medium", timeStyle: "short"});
export function MeetingEditor({ meeting, data, busy, run, onCancel, onSaved }: {
  meeting: Meeting; data: Data; busy: boolean; run: Run; onCancel: () => void; onSaved: (scheduleChanged: boolean) => void;
}) {
  // Retain the version that opened the form; a background refresh must not hide
  // a conflict or replace an unsaved draft underneath the person editing.
  const [base, setBase] = useState(meeting);
  const [title, setTitle] = useState(meeting.title);
  const [type, setType] = useState(meeting.meeting_type);
  const [start, setStart] = useState(localMeetingTime(meeting.starts_at));
  const [end, setEnd] = useState(localMeetingTime(meeting.ends_at));
  const [startChoice, setStartChoice] = useState("");
  const [endChoice, setEndChoice] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [baseRequiredIds, setBaseRequiredIds] = useState(() => requiredStudentIds(data.snapshots, meeting.id));
  const [requiredIds, setRequiredIds] = useState(() => requiredStudentIds(data.snapshots, meeting.id));
  const [rosterAcknowledged, setRosterAcknowledged] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const records = data.attendance.filter(a => a.meeting_id === meeting.id);
  const lockedMeeting = meetingLockReason(meeting);
  const lockReason = scheduleLockReason(meeting, records, data.strikes.some(s => s.meeting_id === meeting.id));
  const currentRequiredIds = requiredStudentIds(data.snapshots, meeting.id);
  const stale = meeting.version !== base.version || requiredRosterChanges(baseRequiredIds, currentRequiredIds).changed;
  const rosterChanges = requiredRosterChanges(baseRequiredIds, requiredIds);
  const rosterOptions = meetingRosterOptions(data, meeting.id, [...baseRequiredIds, ...requiredIds]);
  const changedRequiredIds = new Set([...rosterChanges.added, ...rosterChanges.removed]);
  const lockedRosterChange = rosterOptions.some(option => option.lockReason && changedRequiredIds.has(option.id));
  let startsAt = base.starts_at, endsAt = base.ends_at, timeError = "";
  try {
    startsAt = resolveMeetingTime(start, base.starts_at, startChoice);
    endsAt = resolveMeetingTime(end, base.ends_at, endChoice);
    if (Date.parse(endsAt) <= Date.parse(startsAt)) timeError = "End time must be after start time. For an overnight meeting, choose the next date for the end.";
  } catch (e) { timeError = (e as Error).message; }
  const timeChanged = Date.parse(startsAt) !== Date.parse(base.starts_at) || Date.parse(endsAt) !== Date.parse(base.ends_at);
  const changed = title.trim() !== base.title || type !== base.meeting_type || timeChanged || rosterChanges.changed;
  const pendingRequests = records.filter(a => !!a.notice_at).length;
  const reset = () => {
    setBase(meeting); setTitle(meeting.title); setType(meeting.meeting_type);
    setStart(localMeetingTime(meeting.starts_at)); setEnd(localMeetingTime(meeting.ends_at));
    setStartChoice(""); setEndChoice(""); setAcknowledged(false); setError("");
    setBaseRequiredIds(currentRequiredIds); setRequiredIds(currentRequiredIds); setRosterAcknowledged(false);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (submitting.current || busy) return;
    if (timeError || stale || lockedMeeting || (timeChanged && lockReason)) {
      setError(timeError || (stale ? "Meeting changed. Reload the latest meeting before saving." : lockedMeeting || lockReason)); return;
    }
    if (lockedRosterChange) {
      setError("A participant in this draft is now locked. Reload the latest meeting before changing who is required."); return;
    }
    if ((timeChanged && !acknowledged) || (rosterChanges.changed && !rosterAcknowledged)) {
      setError("Review and acknowledge the changes before saving."); return;
    }
    if (!changed) { onCancel(); return; }
    submitting.current = true;
    setError("");
    void run(async () => {
      await rpc("team_attendance_edit_meeting", { p: {
        meeting_id: base.id, version: base.version, title: title.trim(), meeting_type: type,
        starts_at: startsAt, ends_at: endsAt, acknowledge_schedule_change: acknowledged,
        ...rosterEditFields(baseRequiredIds, requiredIds, rosterAcknowledged),
      }});
    }, "Meeting saved. Only this meeting was changed.", () => onSaved(timeChanged)).finally(() => { submitting.current = false; });
  };
  const offsetPicker = (value: string, original: string, choice: string, setChoice: (v: string) => void, name: string) => {
    const choices = localTimeChoices(value);
    if (choices.length < 2) return null;
    return <label>{name} UTC offset<select value={choice || (value === localMeetingTime(original) ? new Date(Math.floor(Date.parse(original)/60000)*60000).toISOString() : "")} onChange={e => {setChoice(e.target.value); setAcknowledged(false);}}>
      <option value="">Choose which occurrence</option>{choices.map(instant => <option key={instant} value={instant}>{offsetLabel(instant)} · {instant}</option>)}
    </select><small>This clock time occurs twice when daylight saving ends.</small></label>;
  };
  return <form className="att-form att-edit-form" onSubmit={submit} aria-label="Edit meeting">
    <h3>Edit meeting</h3>
    <p className="att-muted">This meeting only. Edit its details and who is required without changing other dates in a repeating schedule.</p>
    {error && <p className="att-error" role="alert">{error}</p>}
    {(stale || lockedRosterChange) && <div className="att-attention" role="alert"><p>{stale
      ? "The meeting or required roster changed since this draft was opened. Reload the latest meeting before making more changes."
      : "A participant in this draft is now locked. Reload the latest meeting before changing who is required."}</p><button type="button" className="att-secondary" disabled={busy} onClick={reset}>Reload latest meeting</button><p className="att-muted">Reloading discards the unsaved fields below.</p></div>}
    <label>Meeting title<input autoFocus disabled={!!lockedMeeting} value={title} onChange={e => setTitle(e.target.value)} required maxLength={150}/></label>
    <label>Meeting type<select disabled={!!lockedMeeting||base.meeting_type==='stem_outreach'} value={type} onChange={e => setType(e.target.value)}><option value="offseason">Offseason</option><option value="preseason">Preseason</option><option value="other">Other / build / competition</option>{base.meeting_type==='stem_outreach'&&<option value="stem_outreach">STEM outreach · optional, no strikes</option>}</select></label>
    <p className="att-muted">Time zone: <strong>{Intl.DateTimeFormat().resolvedOptions().timeZone}</strong> (your device). Choose both dates for an overnight meeting.</p>
    {lockReason && <p className="att-attention">{lockReason}{!lockedMeeting && " You can still edit its title, type, and unlocked participants before the meeting starts."}</p>}
    <div className="att-grid"><label>Meeting start<input type="datetime-local" value={start} disabled={!!lockReason} required onChange={e => {setStart(e.target.value);setStartChoice("");setAcknowledged(false);}}/></label>
      <label>Meeting end<input type="datetime-local" value={end} disabled={!!lockReason} required onChange={e => {setEnd(e.target.value);setEndChoice("");setAcknowledged(false);}}/></label></div>
    {!lockReason && <>{offsetPicker(start, base.starts_at, startChoice, setStartChoice, "Start")}{offsetPicker(end, base.ends_at, endChoice, setEndChoice, "End")}</>}
    {timeError && <p className="att-error" role="alert">{timeError}</p>}
    <fieldset className="att-edit-roster" disabled={busy || !!lockedMeeting || base.meeting_type==='stem_outreach'}>
      <legend>Required participants</legend>
      <p className="att-muted">Changing this list saves a custom required roster for this date. Broad roster sync will no longer update who is required for this date. Leave it unchanged to keep the current requirement mode.</p>
      <div className="att-toolbar"><button type="button" className="att-secondary" onClick={() => {setRequiredIds(bulkRequiredSelection(rosterOptions, requiredIds, true));setRosterAcknowledged(false);}}>All active</button>
        <button type="button" className="att-secondary" onClick={() => {setRequiredIds(bulkRequiredSelection(rosterOptions, requiredIds, false));setRosterAcknowledged(false);}}>Clear all</button></div>
      <p className="att-muted">Shortcuts keep locked participants unchanged. A participant’s required status is locked by an existing attendance request, recorded attendance, a reviewed decision, or any strike. Requests must use the normal review workflow. People no longer eligible also keep their saved required status.</p>
      {!rosterOptions.length && <p>No eligible participants or saved meeting roster.</p>}
      <div className="att-edit-roster-list">{rosterOptions.map(option => <label key={option.id} className="att-check">
        <input type="checkbox" aria-label={option.name} aria-describedby={`required-participant-${option.id}`} checked={requiredIds.includes(option.id)} disabled={!!option.lockReason}
          onChange={e => {const checked = e.target.checked; setRequiredIds(previous => checked ? [...previous.filter(id => id !== option.id), option.id].sort() : previous.filter(id => id !== option.id));setRosterAcknowledged(false);}}/>
        <span>{option.name}<small id={`required-participant-${option.id}`}>{option.memberStatus === "registered" ? "Registered" : option.memberStatus === "prospective" ? "Prospective" : option.memberStatus === "inactive" ? "Inactive" : "No longer on the eligible roster"}{option.lockReason && <> · {option.lockReason}</>}</small></span>
      </label>)}</div>
      <p aria-live="polite">{requiredIds.length} required participant{requiredIds.length === 1 ? "" : "s"} selected.</p>
    </fieldset>
    {changed && <section className="att-edit-review" aria-label="Review meeting changes"><h4>Review changes</h4>
      {title.trim() !== base.title && <p>Title: {base.title} → {title.trim() || "(enter a title)"}</p>}
      {type !== base.meeting_type && <p>Type: {base.meeting_type} → {type}</p>}
      {timeChanged && <><p>From: {when(base.starts_at)} – {when(base.ends_at)}</p><p>To: {when(startsAt)} – {when(endsAt)}</p>
        <p>Saving closes check-in and invalidates the current code. Reopen it at the new time. No message is sent to attendees.</p>
        {pendingRequests > 0 && <p>{pendingRequests} existing request{pendingRequests === 1 ? " keeps its" : "s keep their"} saved reason, submission time, and expected time. Review whether those requests still fit the new schedule. Notice timing will use the new start.</p>}
        <label className="att-check"><input type="checkbox" checked={acknowledged} required onChange={e => setAcknowledged(e.target.checked)}/>I reviewed the new schedule and will tell attendees about the change.</label></>}
      {rosterChanges.changed && <><p>Required participants: {rosterChanges.before} → {rosterChanges.after}</p>
        <p>Added: {rosterChanges.added.length}. Removed: {rosterChanges.removed.length}.</p>
        <p>{rosterChanges.after ? "This date will use a custom selected-participant roster." : "This date will become optional."} Broad roster sync will no longer update who is required for this date. No message is sent to participants.</p>
        <p>Participants with existing attendance requests keep their saved requirement and use the normal request review workflow. Request content, times, and review status stay unchanged.</p>
        <label className="att-check"><input type="checkbox" checked={rosterAcknowledged} required onChange={e => setRosterAcknowledged(e.target.checked)}/>I reviewed who is required and will tell affected participants about the change.</label></>}
      <p className="att-muted">Recorded attendance, excuse decisions, and strikes will not be recalculated.</p>
    </section>}
    <div className="att-toolbar"><button disabled={busy || stale || lockedRosterChange || !!lockedMeeting || !!timeError || !changed || (timeChanged && (!acknowledged || !!lockReason)) || (rosterChanges.changed && !rosterAcknowledged)}>Save meeting</button><button className="att-secondary" type="button" disabled={busy} onClick={onCancel}>Cancel</button><button className="att-secondary" type="button" disabled={busy} onClick={()=>void run(async()=>{}, "Meeting refreshed")}>Refresh meeting</button></div>
  </form>;
}
