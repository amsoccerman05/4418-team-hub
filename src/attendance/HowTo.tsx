import { useEffect, useRef } from "react";
import { BookOpen, CalendarDays, Clock, ClipboardCheck, HelpCircle } from "lucide-react";

export function AttendanceHowTo({ canManage, canReadTeam = false, canRequest = false }: { canManage: boolean; canReadTeam?: boolean; canRequest?: boolean }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({preventScroll: true}); heading.current?.scrollIntoView({block: "start"}); }, []);
  return <section className="att-how-to" aria-labelledby="attendance-how-to-heading">
    <div className="att-view-heading"><h2 id="attendance-how-to-heading" ref={heading} tabIndex={-1}><BookOpen size={22} aria-hidden="true" /> How to use Attendance</h2>
      <p>Sign in to Team Hub with your existing team account, then open Attendance. Start here for check-in, schedule requests, and help with your record.</p></div>
    <div className="att-panel att-help-start"><CalendarDays size={24} aria-hidden="true" /><div><h3>Find your meeting</h3>
      <p>Open <a href="#attendance/calendar">Calendar</a> and choose a meeting. “You’re expected at this meeting” means you are on its required roster. Check the date and time, especially after a schedule change. Times use your device’s local time zone.</p>
      <p>If a meeting is missing, or your required status looks wrong, contact a lead or Mentor. Use <strong>Refresh</strong> to load changes made on another device.</p></div></div>
    <div className="att-help-grid">
      <article className="att-panel"><h3><ClipboardCheck size={20} aria-hidden="true" /> When you arrive</h3><ol>
        <li>Open the meeting from <strong>Calendar</strong> or <strong>View meeting / check in</strong>.</li>
        <li>Ask leadership for the current <strong>6-digit meeting code</strong>.</li>
        <li>Enter it and choose <strong>Check in</strong>. Wait for <strong>Check-in recorded</strong> and your arrival time.</li>
      </ol><p>Check-in opens when leadership enables it, no earlier than 30 minutes before start. A code lasts up to 30 minutes and may be replaced. If it expires, ask for a new one. After five incorrect attempts, wait 15 minutes or ask leadership for help.</p>
      <p>More than five minutes after the scheduled start is recorded as Late. A schedule request does not check you in.</p></article>
      <article className="att-panel"><h3><Clock size={20} aria-hidden="true" /> When you leave</h3><ol>
        <li>During the meeting, open your checked-in meeting.</li>
        <li>Choose <strong>Check out</strong> when you actually leave, then confirm.</li>
        <li>Check that your departure time appears.</li>
      </ol><p>Leaving before the scheduled end records <strong>Left early</strong>. Checking out does not ask for an excuse. The self-service button is only available after you check in and while the meeting is in progress, before its scheduled end.</p>
      <p>If the meeting has ended or you forgot to check out, contact a lead or Mentor to correct the record. The app does not invent a departure time.</p></article>
      <article className="att-panel"><h3>Absent, arriving late, or leaving early?</h3><ol>
        <li>{canRequest ? <>Open <strong>My Requests</strong>, choose your meeting, and select <strong>Report my attendance issue</strong>. </> : <>Open the meeting. </>}Expand <strong>Report attendance issue</strong>.</li>
        <li>Choose <strong>I will be absent</strong>, <strong>I will arrive late</strong>, or <strong>I need to leave early</strong>. For late arrival or early departure, enter the expected time.</li>
        <li>Add your reason and choose <strong>Report an attendance issue</strong>.</li>
        <li>Open <strong>{canRequest || !canReadTeam ? "My Requests" : "Absence & Schedule Requests"}</strong> to see the review status. Choose <strong>All requests</strong> if it is no longer pending.</li>
      </ol><p>Give at least 24 hours’ notice when possible. Shorter notice still needs review. During a meeting, only early-departure requests are available; after it ends, contact leadership. If both late arrival and early departure apply, contact leadership.</p>
      <p>Before the meeting ends, <strong>Edit request</strong> lets you update a request. Each update records a new submission time and sends it back for review. A Mentor or Program Manager decides whether to excuse it; a pending request is not approval. Student leaders, including the Program Manager, use the same request process and cannot approve their own request. Program Manager requests go to other Mentors who are not Program Managers for review. Attendance participation does not change their management access in Team Hub or the other team apps.</p></article>
      <article className="att-panel"><h3><HelpCircle size={20} aria-hidden="true" /> Check your record or ask for a correction</h3>
        <p>Open a meeting for your arrival, departure, request, and review result. Use <strong>History &amp; strikes</strong>, or the <strong>History</strong> and <strong>Strikes</strong> tabs, to see your record.</p>
        <p>For a wrong check-in, departure, or meeting requirement, tell a lead or Mentor which meeting and what needs correcting. For an excuse decision or strike, contact a Mentor or Program Manager. Meeting details are limited to meeting leadership. Nobody can approve their own requests.</p>
        <p>Attendance percentage uses required, completed meetings. Excused and Not Required records are excluded; Present, Late, and Left Early count as attended.</p>
        <p>Read <strong>Attendance Policy · v0.3</strong> above for the full policy and Slack #Absent procedure. For a private reason, contact a Mentor directly.</p></article>
    </div>
    {canManage && <section className="att-panel" aria-labelledby="attendance-edit-help"><h3 id="attendance-edit-help">For meeting leadership: edit an upcoming meeting</h3><ol>
      <li>Open <strong>Calendar</strong>, select a meeting that has not started, and choose <strong>Edit meeting</strong>.</li>
      <li>Update the title, meeting type, or available start/end fields. Review the local time zone and the change summary.</li>
      <li>Choose <strong>Save meeting</strong>. Use <strong>Cancel</strong> to leave it unchanged.</li>
    </ol><p>Only the selected meeting changes, including when it was created as part of a repeating schedule. The required roster stays the same. Attendance records, excuse decisions, and strikes are not recalculated.</p>
    <p>All meeting details are locked once the meeting starts or its attendance is complete. Before start, the schedule is also locked if someone has checked in or attendance decisions or strikes have been recorded. If another leader changes the meeting while you are editing, reload the latest version before trying again.</p>
    <p>Changes are recorded in <strong>Meeting controls → View audit history</strong>. Tell attendees about schedule changes through your normal team channel; saving a meeting does not send a message.</p></section>}
    <a className="att-link-button" href="#attendance/calendar">Open meeting calendar →</a>
  </section>;
}
