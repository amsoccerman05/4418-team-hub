import { automaticAbsenceStrikePreview } from "./automaticAbsenceStrikes";
import type { Data, Meeting } from "./service";

export function AutomaticAbsencePreview({ data, meeting }: { data: Data; meeting: Meeting }) {
  const { additions, pendingRequests } = automaticAbsenceStrikePreview(data, meeting);
  return <section className="att-attention" aria-label="Automatic attendance notice preview">
    <h4>Completing attendance will assign {additions.length} automatic {additions.length === 1 ? "attendance notice" : "attendance notices"}</h4>
    <p>One Unexcused Absence attendance notice per required member marked absent without an approved or pending excuse. Missing required check-ins will be marked absent.</p>
    <p>{pendingRequests.length} pending absence {pendingRequests.length === 1 ? "request" : "requests"} skipped for now. Review pending requests before completing attendance when possible.</p>
    <p>Existing absence attendance notices, including rescinded attendance notices, will not be assigned again. Earlier completed meetings stay unchanged.</p>
    {additions.length > 0 && <details><summary>Members receiving automatic attendance notices</summary><ul>{additions.map(a => <li key={a.id}>{data.members.find(m => m.student_id === a.student_id)?.display_name || "Name unavailable"}</li>)}</ul></details>}
  </section>;
}
