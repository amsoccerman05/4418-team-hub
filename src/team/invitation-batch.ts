/** A client-side review boundary, not an authorization check or email quota. */
export const INVITATION_BATCH_LIMIT = 20;
export const INVITATION_ROLES = ['student', 'lead', 'mentor', 'admin', 'readonly'] as const;
export const INVITATION_REGISTRATIONS = ['', 'prospective', 'registered', 'inactive'] as const;
export type InvitationRole = typeof INVITATION_ROLES[number];
export type InvitationRegistration = typeof INVITATION_REGISTRATIONS[number];
export type InvitationDraft = {
  display_name: string;
  email: string;
  role: string;
  reason: string;
  area_id: string;
  member_status: string;
};
export type InvitationPayload = Readonly<Omit<InvitationDraft, 'role' | 'member_status'> & {
  id: string;
  role: InvitationRole;
  member_status: InvitationRegistration;
}>;
export type ExistingInvitationEmail = { email: string; kind: 'member' | 'invitation' | 'review' };
export type InvitationValidationContext = {
  areas: readonly { id: string; active: boolean }[];
  existingEmails: readonly ExistingInvitationEmail[];
  studentOnly?: boolean;
};
export type InvitationIssue = {
  rowId: string | null;
  field: keyof InvitationDraft | 'id' | 'batch';
  code: 'required' | 'invalid' | 'too_long' | 'inactive_area' | 'duplicate_email' | 'duplicate_id' | 'batch_limit' | 'empty_batch';
  message: string;
};
/** Only these known handler rejections establish that reservation/send did not occur. */
export const PRE_RESERVATION_CODES = [
  'invalid_request', 'sign_in_required', 'origin_not_allowed', 'method_not_allowed',
  'manager_required', 'inviter_required', 'student_only', 'invitation_not_owned', 'invalid_details', 'inactive_area', 'existing_account',
] as const;
export type InvitationOutcome =
  | { status: 'accepted'; alreadyInvited?: boolean; message?: string }
  | { status: 'not_sent'; stage: 'before_reservation'; code: typeof PRE_RESERVATION_CODES[number]; message?: string }
  | { status: 'review'; message?: string };
export type InvitationRowStatus = 'draft' | 'ready' | 'sending' | 'accepted' | 'not_sent' | 'review';
export type InvitationRow = Readonly<{
  id: string;
  draft: Readonly<InvitationDraft>;
  status: InvitationRowStatus;
  reviewedPayload: InvitationPayload | null;
  outcome: Readonly<InvitationOutcome> | null;
}>;
const defaults: InvitationDraft = { display_name: '', email: '', role: 'student', reason: '', area_id: '', member_status: '' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const locked = (row: InvitationRow) => ['sending', 'accepted', 'review'].includes(row.status);
export const normalizeInvitationEmail = (email: string) => email.trim().toLowerCase();
function seal(row: InvitationRow): InvitationRow {
  return Object.freeze({ ...row, draft: Object.freeze({ ...row.draft }),
    reviewedPayload: row.reviewedPayload ? Object.freeze({ ...row.reviewedPayload }) : null,
    outcome: row.outcome ? Object.freeze({ ...row.outcome }) : null });
}
function payload(row: InvitationRow): InvitationPayload {
  const d = row.draft;
  return Object.freeze({ id: row.id, display_name: d.display_name.trim(), email: normalizeInvitationEmail(d.email),
    role: d.role as InvitationRole, reason: d.reason.trim(), area_id: d.area_id.trim(), member_status: d.member_status as InvitationRegistration });
}
const payloadKey = (p: InvitationPayload) => JSON.stringify([p.id, p.display_name, p.email, p.role, p.reason, p.area_id, p.member_status]);
export function createInvitationRow(draft: Partial<InvitationDraft> = {}, makeId: () => string = () => crypto.randomUUID()): InvitationRow {
  const id = makeId();
  if (!uuid.test(id)) throw new Error('A valid invitation UUID is required.');
  return seal({ id, draft: { ...defaults, ...draft }, status: 'draft', reviewedPayload: null, outcome: null });
}
/** Editing retains the recipient UUID and always requires a new explicit review. */
export function updateInvitationRow(row: InvitationRow, patch: Partial<InvitationDraft>): InvitationRow {
  if (locked(row)) throw new Error('This recipient has been attempted and cannot be edited or resent.');
  return seal({ ...row, draft: { ...row.draft, ...patch }, status: 'draft', reviewedPayload: null, outcome: null });
}
export function validateInvitationBatch(rows: readonly InvitationRow[], context: InvitationValidationContext): InvitationIssue[] {
  const issues: InvitationIssue[] = [];
  const add = (rowId: string | null, field: InvitationIssue['field'], code: InvitationIssue['code'], message: string) => issues.push({ rowId, field, code, message });
  if (!rows.length) add(null, 'batch', 'empty_batch', 'Add at least one recipient.');
  if (rows.length > INVITATION_BATCH_LIMIT) add(null, 'batch', 'batch_limit', `Review up to ${INVITATION_BATCH_LIMIT} recipients at a time. This is a UI batch limit, not an email quota.`);
  const emailCounts = new Map<string, number>(), idCounts = new Map<string, number>();
  for (const row of rows) {
    const email = normalizeInvitationEmail(row.draft.email);
    emailCounts.set(email, (emailCounts.get(email) || 0) + 1);
    idCounts.set(row.id, (idCounts.get(row.id) || 0) + 1);
  }
  for (const row of rows) {
    const p = payload(row);
    if (!uuid.test(row.id)) add(row.id, 'id', 'invalid', 'A valid invitation UUID is required.');
    if ((idCounts.get(row.id) || 0) > 1) add(row.id, 'id', 'duplicate_id', 'Each recipient needs a distinct invitation UUID.');
    for (const [field, max, name] of [['display_name', 150, 'Display name'], ['reason', 2000, 'Invitation reason']] as const) {
      if (!p[field]) add(row.id, field, 'required', `${name} is required.`);
      else if (p[field].length > max) add(row.id, field, 'too_long', `${name} must be ${max} characters or fewer.`);
    }
    if (!p.email) add(row.id, 'email', 'required', 'Email is required.');
    else if (p.email.length > 254) add(row.id, 'email', 'too_long', 'Email must be 254 characters or fewer.');
    else if (!emailPattern.test(p.email)) add(row.id, 'email', 'invalid', 'Enter a valid email address.');
    if (context.studentOnly && p.role !== 'student') add(row.id, 'role', 'invalid', 'Leads can invite students only.');
    if (!(INVITATION_ROLES as readonly string[]).includes(p.role)) add(row.id, 'role', 'invalid', 'Choose an existing account role.');
    if (!(INVITATION_REGISTRATIONS as readonly string[]).includes(p.member_status)) add(row.id, 'member_status', 'invalid', 'Choose an existing attendance registration status.');
    if (!locked(row) && p.area_id && !context.areas.some(area => area.id === p.area_id && area.active)) add(row.id, 'area_id', 'inactive_area', 'Choose an active area or leave it unassigned.');
    if (p.email && (emailCounts.get(p.email) || 0) > 1) add(row.id, 'email', 'duplicate_email', 'This email appears more than once in the batch.');
    // Accepted/review rows are retained for status; roster refresh must not erase them.
    if (!locked(row) && p.email) {
      const existing = context.existingEmails.find(entry => normalizeInvitationEmail(entry.email) === p.email);
      if (existing) add(row.id, 'email', 'duplicate_email', existing.kind === 'member'
        ? 'This email already belongs to a team member.'
        : existing.kind === 'review' ? 'This invitation needs review; do not resend.' : 'An invitation for this email is already listed; check its status.');
    }
  }
  return issues;
}
/** Call only after the operator has explicitly reviewed these exact recipients and roles. */
export function reviewInvitationBatch(rows: readonly InvitationRow[], context: InvitationValidationContext): { rows: InvitationRow[]; issues: InvitationIssue[] } {
  const issues = validateInvitationBatch(rows, context);
  const blocked = new Set(issues.map(issue => issue.rowId));
  return { issues, rows: rows.map(row => {
    if (locked(row) || row.status === 'not_sent') return seal(row);
    const ready = !blocked.has(null) && !blocked.has(row.id);
    return seal({ ...row, status: ready ? 'ready' : 'draft', reviewedPayload: ready ? payload(row) : null, outcome: null });
  }) };
}
export type ServerInvitationRecord = { id: string; status: string };
/** Exact server identity may settle an uncertain attempt; it never queues a send. */
export function reconcileInvitationBatch(rows: readonly InvitationRow[], invitations: readonly ServerInvitationRecord[]): InvitationRow[] {
  return rows.map(row => {
    if (row.status !== 'review' && row.status !== 'sending') return seal(row);
    const matches = invitations.filter(invitation => invitation.id === row.id);
    if (matches.length !== 1 || !['pending', 'account_active'].includes(matches[0].status)) return seal(row);
    return seal({ ...row, status: 'accepted', outcome: { status: 'accepted', alreadyInvited: true,
      message: matches[0].status === 'account_active' ? 'The account is active. No new invitation was sent.' : 'Previously accepted invitation confirmed; account provisioning is confirmed. User account setup is still pending. Inbox delivery is not confirmed.' } });
  });
}
export type InvitationSender = (payload: InvitationPayload) => Promise<InvitationOutcome>;
export type InvitationRunResult = { status: 'completed' | 'paused' | 'stopped' | 'already_running'; rows: readonly InvitationRow[] };
export type InvitationBatchRunner = {
  snapshot(): readonly InvitationRow[];
  replaceRows(rows: readonly InvitationRow[]): void;
  start(): Promise<InvitationRunResult>;
  pause(): void;
  reconcile(invitations: readonly ServerInvitationRecord[]): readonly InvitationRow[];
  readonly isRunning: boolean;
};
const uncertain = (): InvitationOutcome => ({ status: 'review', message: 'The result could not be confirmed. Check the account and Activity; do not resend.' });
function safeOutcome(value: InvitationOutcome): InvitationOutcome {
  if (value?.status === 'accepted') return { status: 'accepted', alreadyInvited: value.alreadyInvited === true, message: value.message || (value.alreadyInvited ? 'Previously accepted invitation; account provisioning is confirmed. User account setup is still pending. Inbox delivery is not confirmed.' : 'Invitation accepted by the email service; account provisioning is confirmed. User account setup is still pending. Inbox delivery is not confirmed.') };
  if (value?.status === 'not_sent' && value.stage === 'before_reservation' && (PRE_RESERVATION_CODES as readonly string[]).includes(value.code)) return { ...value };
  if (value?.status === 'review') return { status: 'review', message: value.message || uncertain().message };
  return uncertain();
}
/** Keep this runner in the owning page while a modal is closed; no storage is used. */
export function createInvitationBatchRunner({ rows: initialRows, sender, onRow }: {
  rows: readonly InvitationRow[];
  sender: InvitationSender;
  onRow?: (row: InvitationRow, rows: readonly InvitationRow[]) => void;
}): InvitationBatchRunner {
  let rows = initialRows.map(seal), running = false, pauseRequested = false;
  const snapshot = () => Object.freeze([...rows]);
  const result = (status: InvitationRunResult['status']): InvitationRunResult => ({ status, rows: snapshot() });
  const change = (row: InvitationRow) => {
    const next = seal(row);
    rows = rows.map(old => old.id === next.id ? next : old);
    // An observer failure must never lose the recorded send outcome or trigger a retry.
    try { onRow?.(next, snapshot()); } catch { pauseRequested = true; }
  };
  return {
    snapshot,
    get isRunning() { return running; },
    replaceRows(nextRows) {
      if (running) throw new Error('Pause and wait for the current request before editing the batch.');
      for (const old of rows.filter(locked)) {
        const next = nextRows.find(row => row.id === old.id);
        if (!next || next.status !== old.status || payloadKey(payload(next)) !== payloadKey(payload(old))) throw new Error('Attempted recipient status cannot be removed or reset.');
      }
      rows = nextRows.map(row => seal(rows.find(old => old.id === row.id && locked(old)) || row));
    },
    reconcile(invitations) {
      if (running) throw new Error('Wait for the current request to finish before reconciling.');
      const reconciled = reconcileInvitationBatch(rows, invitations);
      for (const row of reconciled) if (rows.find(old => old.id === row.id)?.status !== row.status) change(row);
      return snapshot();
    },
    pause() { pauseRequested = true; },
    async start() {
      if (running) return result('already_running');
      if (!rows.length || rows.length > INVITATION_BATCH_LIMIT || new Set(rows.map(row => row.id)).size !== rows.length || new Set(rows.map(row => normalizeInvitationEmail(row.draft.email))).size !== rows.length) return result('stopped');
      running = true;
      pauseRequested = false;
      try {
        for (const row of rows) {
          if (pauseRequested) return result('paused');
          if (row.status !== 'ready') continue;
          if (!row.reviewedPayload || payloadKey(payload(row)) !== payloadKey(row.reviewedPayload)) {
            change({ ...row, status: 'draft', reviewedPayload: null, outcome: null });
            return result('stopped');
          }
          change({ ...row, status: 'sending', outcome: null });
          // A pause requested by the sending observer applies to the next recipient.
          let outcome: InvitationOutcome;
          try { outcome = safeOutcome(await sender(row.reviewedPayload)); } catch { outcome = uncertain(); }
          change({ ...row, status: outcome.status, outcome });
          if (outcome.status !== 'accepted') return result('stopped');
        }
        return result(rows.every(row => row.status === 'accepted') ? 'completed' : 'stopped');
      } finally { running = false; }
    },
  };
}
