import { test, expect } from '@playwright/test';
import {
  INVITATION_BATCH_LIMIT, INVITATION_ROLES, createInvitationRow, updateInvitationRow,
  validateInvitationBatch, reviewInvitationBatch, reconcileInvitationBatch, createInvitationBatchRunner,
  type InvitationDraft, type InvitationOutcome, type InvitationPayload,
  type InvitationRow, type InvitationValidationContext,
} from '../src/team/invitation-batch';

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const context: InvitationValidationContext = {
  areas: [{ id: id(100), active: true }, { id: id(101), active: false }], existingEmails: [],
};
function row(n: number, patch: Partial<InvitationDraft> = {}) {
  return createInvitationRow({ display_name: `Member ${n}`, email: `member${n}@example.test`, role: 'student', reason: 'Joining the team', ...patch }, () => id(n));
}
function reviewed(count = 2) { return reviewInvitationBatch(Array.from({ length: count }, (_, i) => row(i + 1)), context).rows; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const accepted: InvitationOutcome = { status: 'accepted' };

test('review normalizes the exact payload, includes optional team details and freezes it', () => {
  const original = row(1, { display_name: '  Alex Teammate  ', email: '  ALEX@Example.Test ', reason: '  Season registration  ', area_id: id(100), member_status: 'registered' });
  const result = reviewInvitationBatch([original], context);
  expect(result.issues).toEqual([]);
  expect(result.rows[0].status).toBe('ready');
  expect(result.rows[0].reviewedPayload).toEqual({ id: id(1), display_name: 'Alex Teammate', email: 'alex@example.test', role: 'student', reason: 'Season registration', area_id: id(100), member_status: 'registered' });
  expect(original.status).toBe('draft');
  expect(Object.isFrozen(result.rows[0].reviewedPayload)).toBe(true);
  expect(Object.isFrozen(result.rows[0].draft)).toBe(true);
});

for (const role of INVITATION_ROLES) test(`explicit account role ${role} is preserved without granting other authority`, () => {
  const result = reviewInvitationBatch([row(1, { role })], context);
  expect(result.issues).toEqual([]);
  expect(result.rows[0].reviewedPayload?.role).toBe(role);
  expect(Object.keys(result.rows[0].reviewedPayload!)).toEqual(['id', 'display_name', 'email', 'role', 'reason', 'area_id', 'member_status']);
});

test('invalid required fields, bounds, roles, area and registration prevent review', () => {
  const cases: [Partial<InvitationDraft>, string][] = [
    [{ display_name: '  ' }, 'display_name'], [{ display_name: 'x'.repeat(151) }, 'display_name'],
    [{ email: '' }, 'email'], [{ email: 'not-an-email' }, 'email'], [{ email: 'a b@example.test' }, 'email'], [{ email: `${'x'.repeat(250)}@example.test` }, 'email'],
    [{ reason: '  ' }, 'reason'], [{ reason: 'x'.repeat(2001) }, 'reason'],
    [{ role: 'owner' }, 'role'], [{ role: 'Admin' }, 'role'],
    [{ area_id: id(101) }, 'area_id'], [{ area_id: id(999) }, 'area_id'], [{ member_status: 'approved' }, 'member_status'],
  ];
  for (const [patch, field] of cases) {
    const result = reviewInvitationBatch([row(1, patch)], context);
    expect(result.issues.some(issue => issue.field === field)).toBe(true);
    expect(result.rows[0].status).toBe('draft');
    expect(result.rows[0].reviewedPayload).toBeNull();
  }
  expect(reviewInvitationBatch([row(1, { display_name: 'x'.repeat(150), reason: 'x'.repeat(2000), member_status: '', area_id: '' })], context).issues).toEqual([]);
});

test('all duplicate batch emails are blocked case-insensitively', () => {
  const result = reviewInvitationBatch([row(1, { email: 'Alex@Example.Test' }), row(2, { email: ' alex@example.test ' })], context);
  expect(result.issues.filter(issue => issue.code === 'duplicate_email').map(issue => issue.rowId)).toEqual([id(1), id(2)]);
  expect(result.rows.every(row => row.status === 'draft')).toBe(true);
});

for (const kind of ['member', 'invitation', 'review'] as const) test(`loaded ${kind} email blocks another invitation`, () => {
  const result = reviewInvitationBatch([row(1)], { ...context, existingEmails: [{ email: ' MEMBER1@EXAMPLE.TEST ', kind }] });
  expect(result.issues.some(issue => issue.code === 'duplicate_email')).toBe(true);
  expect(result.rows[0].status).toBe('draft');
});

test('twenty is a review UI limit only, empty/oversized batches do not become ready', () => {
  expect(INVITATION_BATCH_LIMIT).toBe(20);
  expect(reviewed(20).every(row => row.status === 'ready')).toBe(true);
  const result = reviewInvitationBatch(Array.from({ length: 21 }, (_, i) => row(i + 1)), context);
  expect(result.issues[0]).toMatchObject({ rowId: null, code: 'batch_limit' });
  expect(result.issues[0].message).toContain('not an email quota');
  expect(result.rows.every(row => row.status === 'draft')).toBe(true);
  expect(validateInvitationBatch([], context)[0].code).toBe('empty_batch');
});

test('UUID is generated once, retained across edits and review, and duplicate IDs are rejected', () => {
  let generated = 0;
  const first = createInvitationRow({ display_name: 'A', email: 'a@example.test', reason: 'Joining' }, () => { generated++; return id(1); });
  const changed = updateInvitationRow(reviewInvitationBatch([first], context).rows[0], { role: 'mentor' });
  expect(changed.id).toBe(first.id);
  expect(changed.status).toBe('draft');
  expect(changed.reviewedPayload).toBeNull();
  expect(reviewInvitationBatch([changed], context).rows[0].reviewedPayload?.id).toBe(first.id);
  expect(generated).toBe(1);
  expect(() => createInvitationRow({}, () => 'bad-id')).toThrow();
  expect(validateInvitationBatch([first, { ...row(2), id: first.id }], context).filter(issue => issue.code === 'duplicate_id')).toHaveLength(2);
});

test('one request in flight, concurrent start is ignored and current request finishes before pause', async () => {
  const first = deferred<InvitationOutcome>(), second = deferred<InvitationOutcome>();
  const sent: InvitationPayload[] = [], events: string[] = [];
  let active = 0, maximum = 0;
  const runner = createInvitationBatchRunner({ rows: reviewed(), onRow: row => events.push(row.status), sender: async payload => {
    sent.push(payload); active++; maximum = Math.max(maximum, active);
    const result = await (sent.length === 1 ? first.promise : second.promise); active--; return result;
  } });
  const run = runner.start();
  expect(runner.isRunning).toBe(true);
  expect(sent).toHaveLength(1);
  expect((await runner.start()).status).toBe('already_running');
  expect(() => runner.replaceRows(reviewed())).toThrow();
  runner.pause();
  expect(runner.snapshot()[0].status).toBe('sending');
  first.resolve(accepted);
  expect((await run).status).toBe('paused');
  expect(sent).toHaveLength(1);
  expect(runner.snapshot().map(row => row.status)).toEqual(['accepted', 'ready']);
  const resume = runner.start();
  expect(sent.map(payload => payload.id)).toEqual([id(1), id(2)]);
  second.resolve(accepted);
  expect((await resume).status).toBe('completed');
  expect(maximum).toBe(1);
  expect(events).toEqual(['sending', 'accepted', 'sending', 'accepted']);
  await runner.start();
  expect(sent).toHaveLength(2);
  expect(runner.isRunning).toBe(false);
  expect(runner.snapshot()[0].outcome?.message).toContain('Inbox delivery is not confirmed');
  expect(runner.snapshot()[0].outcome?.message).toContain('User account setup is still pending');
  expect(runner.snapshot()[0].outcome?.message).not.toMatch(/setup (?:is )?complete|account is active/i);
});

test('a changed reviewed payload is invalidated before the sender is called', async () => {
  const ready = reviewed(1)[0];
  const tampered = { ...ready, draft: { ...ready.draft, role: 'admin' } };
  let sends = 0;
  const runner = createInvitationBatchRunner({ rows: [tampered], sender: async () => { sends++; return accepted; } });
  expect((await runner.start()).status).toBe('stopped');
  expect(sends).toBe(0);
  expect(runner.snapshot()[0]).toMatchObject({ status: 'draft', reviewedPayload: null });
});

for (const failure of ['throw', 'review', 'unknown', 'unsafe_not_sent'] as const) test(`${failure} becomes review, stops immediately and is never resent on explicit resume`, async () => {
  const sent: string[] = [];
  const runner = createInvitationBatchRunner({ rows: reviewed(), sender: async payload => {
    sent.push(payload.id);
    if (payload.id === id(2)) return accepted;
    if (failure === 'throw') throw new Error('Do not expose this private provider response');
    if (failure === 'review') return { status: 'review' };
    if (failure === 'unknown') return { status: 'pending' } as unknown as InvitationOutcome;
    return { status: 'not_sent', stage: 'before_reservation', code: 'already_reserved' } as unknown as InvitationOutcome;
  } });
  expect((await runner.start()).status).toBe('stopped');
  expect(sent).toEqual([id(1)]);
  expect(runner.snapshot().map(row => row.status)).toEqual(['review', 'ready']);
  expect(runner.snapshot()[0].outcome?.message).not.toContain('private provider');
  expect(() => updateInvitationRow(runner.snapshot()[0], { reason: 'Retry' })).toThrow();
  expect(() => runner.replaceRows(reviewed())).toThrow();
  expect((await runner.start()).status).toBe('stopped');
  expect(sent).toEqual([id(1), id(2)]);
  await runner.start();
  expect(sent).toHaveLength(2);
});

test('conclusive pre-reservation rejection stops; explicit edit/review is required for that recipient', async () => {
  let calls = 0;
  const runner = createInvitationBatchRunner({ rows: reviewed(1), sender: async () => ++calls === 1
    ? { status: 'not_sent', stage: 'before_reservation', code: 'invalid_details' } : accepted });
  expect((await runner.start()).status).toBe('stopped');
  expect(runner.snapshot()[0].status).toBe('not_sent');
  runner.replaceRows(reviewInvitationBatch(runner.snapshot(), context).rows);
  await runner.start();
  expect(calls).toBe(1);
  const corrected = updateInvitationRow(runner.snapshot()[0], { reason: 'Corrected joining reason' });
  runner.replaceRows(reviewInvitationBatch([corrected], context).rows);
  expect((await runner.start()).status).toBe('completed');
  expect(calls).toBe(2);
  expect(runner.snapshot()[0].id).toBe(id(1));
});

test('in-memory close/reopen snapshots preserve accepted state and cannot remove/reset accepted rows', async () => {
  let calls = 0;
  const runner = createInvitationBatchRunner({ rows: reviewed(1), sender: async () => { calls++; return accepted; } });
  await runner.start();
  const reopened = createInvitationBatchRunner({ rows: runner.snapshot(), sender: async () => { calls++; return accepted; } });
  expect((await reopened.start()).status).toBe('completed');
  expect(calls).toBe(1);
  expect(() => runner.replaceRows([])).toThrow();
  expect(() => runner.replaceRows(reviewed(1))).toThrow();
  expect(reviewInvitationBatch(runner.snapshot(), { ...context, existingEmails: [{ email: 'member1@example.test', kind: 'invitation' }] }).rows[0].status).toBe('accepted');
});

test('runner rejects duplicate IDs/emails or oversized reassembled batches before sending', async () => {
  let calls = 0;
  const ready = reviewed(1)[0];
  for (const rows of [[ready, ready], [ready, { ...ready, id: id(2), reviewedPayload: { ...ready.reviewedPayload!, id: id(2) } }], Array.from({ length: 21 }, (_, i) => reviewInvitationBatch([row(i + 1)], context).rows[0])]) {
    const runner = createInvitationBatchRunner({ rows, sender: async () => { calls++; return accepted; } });
    expect((await runner.start()).status).toBe('stopped');
  }
  expect(calls).toBe(0);
});

test('observer exceptions cannot lose an outcome or cause an automatic retry', async () => {
  let calls = 0;
  const runner = createInvitationBatchRunner({ rows: reviewed(), sender: async () => { calls++; return accepted; }, onRow: () => { throw Error('UI observer failure'); } });
  expect((await runner.start()).status).toBe('paused');
  expect(runner.snapshot().map(row => row.status)).toEqual(['accepted', 'ready']);
  expect(calls).toBe(1);
});


test('reconciliation accepts only exact attempted IDs with confirmed server status and never sends', async () => {
  const rows = reviewed(3).map((row, index): InvitationRow => index === 0 ? { ...row, status: 'review', outcome: { status: 'review' } } : index === 1 ? { ...row, status: 'sending' } : row);
  expect(reconcileInvitationBatch(rows, [{ id: id(999), status: 'pending' }]).map(row => row.status)).toEqual(['review', 'sending', 'ready']);
  for (const status of ['processing', 'review', 'unknown']) expect(reconcileInvitationBatch(rows, [{ id: id(1), status }])[0].status).toBe('review');
  const resolved = reconcileInvitationBatch(rows, [{ id: id(1), status: 'pending' }, { id: id(2), status: 'account_active' }, { id: id(3), status: 'pending' }]);
  expect(resolved.map(row => row.status)).toEqual(['accepted', 'accepted', 'ready']);
  expect(resolved[0].outcome).toMatchObject({ status: 'accepted', alreadyInvited: true });
  expect(resolved[0].outcome?.message).toContain('User account setup is still pending');
  expect(resolved[0].outcome?.message).not.toMatch(/setup (?:is )?complete|account is active/i);
  expect(resolved[1].outcome?.message).toContain('The account is active');
  expect(resolved[1].outcome?.message).toContain('No new invitation was sent');
  let sends = 0;
  const runner = createInvitationBatchRunner({ rows, sender: async () => { sends++; return accepted; } });
  runner.reconcile([{ id: id(1), status: 'pending' }, { id: id(2), status: 'account_active' }]);
  expect(sends).toBe(0);
  expect((await runner.start()).status).toBe('completed');
  expect(sends).toBe(1);
  expect(runner.snapshot().every(row => row.status === 'accepted')).toBe(true);
  expect(() => runner.replaceRows(rows)).toThrow();
});

test('reconciliation cannot race an in-flight request or accept ambiguous duplicate server records', async () => {
  const waiting = deferred<InvitationOutcome>();
  const runner = createInvitationBatchRunner({ rows: reviewed(1), sender: () => waiting.promise });
  const run = runner.start();
  expect(() => runner.reconcile([{ id: id(1), status: 'pending' }])).toThrow();
  waiting.resolve({ status: 'review' });
  await run;
  runner.reconcile([{ id: id(1), status: 'pending' }, { id: id(1), status: 'review' }]);
  expect(runner.snapshot()[0].status).toBe('review');
});

test('already-invited acceptance is clearly labeled as prior acceptance', async () => {
  const runner = createInvitationBatchRunner({ rows: reviewed(1), sender: async () => ({ status: 'accepted', alreadyInvited: true }) });
  await runner.start();
  expect(runner.snapshot()[0].outcome?.message).toContain('Previously accepted');
  expect(runner.snapshot()[0].outcome?.message).toContain('User account setup is still pending');
  expect(runner.snapshot()[0].outcome?.message).not.toMatch(/setup (?:is )?complete|account is active/i);
});


for (const attemptedStatus of ['accepted', 'review'] as const) test(`archiving an area does not invalidate a historical ${attemptedStatus} row or resend it`, async () => {
  const first = row(1, { area_id: id(100) });
  const rows = reviewInvitationBatch([first, row(2)], context).rows;
  const sent: string[] = [];
  const runner = createInvitationBatchRunner({
    rows,
    sender: async payload => { sent.push(payload.id); return payload.id === id(1) ? { status: attemptedStatus } : accepted; },
    onRow: updated => { if (updated.id === id(1) && updated.status === 'accepted') runner.pause(); },
  });
  await runner.start();
  expect(runner.snapshot().map(row => row.status)).toEqual([attemptedStatus, 'ready']);
  const archivedContext = { ...context, areas: context.areas.map(area => ({ ...area, active: false })) };
  const refreshed = reviewInvitationBatch(runner.snapshot(), archivedContext);
  expect(refreshed.issues).toEqual([]);
  expect(refreshed.rows[0].draft.area_id).toBe(id(100));
  expect(refreshed.rows[0].status).toBe(attemptedStatus);
  expect(refreshed.rows[1].status).toBe('ready');
  runner.replaceRows(refreshed.rows);
  await runner.start();
  expect(sent).toEqual([id(1), id(2)]);
  expect(runner.snapshot()[0].status).toBe(attemptedStatus);
  expect(runner.snapshot()[1].status).toBe('accepted');
  expect(validateInvitationBatch([row(3, { area_id: id(100) })], archivedContext).some(issue => issue.code === 'inactive_area')).toBe(true);
});
