// Genuine Auth + raw PostgREST tests against one OWNED, empty local stack.
// Representative cross-site boundaries use exact pinned source migrations.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { localFetch, localURL, ORIGIN, API_PORT } from './fabrication-safety.mjs';
import { installSharedSecurityFixture, applySharedCanonicalFixture, sharedCanonicalCatalog } from './shared-security-fixture.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const lit = value => `'${String(value).replaceAll("'", "''")}'`;

export async function runSharedSecurityIntegration({ base, anonKey, serviceKey, sql, gate, waitFor, registerSecret }) {
  assert.equal(localURL(base).origin, `http://127.0.0.1:${API_PORT}`, 'Only the owned disposable stack is supported');
  const authFunction = sql("select pg_get_functiondef('auth.uid()'::regprocedure)");
  assert(!authFunction.includes('test.uid'), 'Real Supabase Auth is required');
  await installSharedSecurityFixture(sql);
  const checks = [];
  const pass = label => { const message = `Shared-site direct-API boundaries: ${label}`; checks.push(message); console.log(`PASS ${message}`); };
  const headers = actor => ({ apikey: anonKey, ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}), Origin: ORIGIN, 'Content-Type': 'application/json', Prefer: 'return=representation' });
  const request = (path, body, actor = null, method = 'POST') => localFetch(base, path, { method, headers: headers(actor), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const rpc = (name, body, actor) => request(`/rest/v1/rpc/${name}`, body, actor);
  async function json(response) {
    const text = await response.text();
    assert(response.ok, `Shared API HTTP ${response.status}: ${text}`);
    return text ? JSON.parse(text) : null;
  }
  async function rejected(response, match = /permission|row-level security/i, status = 403) {
    const body = await response.json(); assert.equal(response.status, status); assert.equal(body.code, '42501'); assert.match(body.message, match);
  }
  const query = q => JSON.parse(sql(q));
  const profile = actor => query(`select to_jsonb(p) from public.profiles p where id=${lit(actor.id)}`);
  const table = name => sql(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from public.${name} t`);
  const fingerprint = names => names.map(table).join('\n');
  const read = (name, filter, actor) => request(`/rest/v1/${name}?select=*&${filter}`, undefined, actor, 'GET').then(json);
  const profilesState = () => table('profiles');
  async function signup(name, role, active = true, data = {}) {
    const email = `shared-security-${name}-${randomUUID()}@example.invalid`, password = `Synthetic-${randomBytes(24).toString('hex')}!`;
    registerSecret(password);
    const created = await json(await request('/auth/v1/signup', { email, password, data: { display_name: `Synthetic ${name}`, role: 'admin', active: true, is_admin: true, ...data } }));
    assert(created.user?.id && created.access_token, 'Real Auth signup must issue a session');
    registerSecret(created.access_token); if (created.refresh_token) registerSecret(created.refresh_token);
    const actor = { id: created.user.id, email, token: created.access_token };
    assert.equal(profile(actor).role, 'readonly', 'Auth metadata must never provision an elevated shared role');
    if (role) sql(`update public.profiles set role=${lit(role)},active=${active} where id=${lit(actor.id)};`);
    return actor;
  }
  const manager = await signup('mentor', 'mentor'), student = await signup('student', 'student');
  await signup('second-mentor','mentor'); // Keep last-Mentor and self-role guards independently testable.
  const legacy=await signup('legacy-admin','admin');
  const adminLead=await signup('admin-lead','admin_lead');
  const lead = await signup('lead', 'lead'), reader = await signup('reader'), inactive = await signup('inactive', 'student', false);
  const assignmentsBefore=table('team_member_positions');
  await applySharedCanonicalFixture(sql);
  assert.equal(profile(legacy).role,'admin_lead');
  assert.equal(profile(manager).role,'mentor');
  assert.equal(table('team_member_positions'),assignmentsBefore);
  assert.equal(sql("select count(*) from public.profiles where role='admin'"),'0');
  // PostgreSQL-normalized schema only. No fixture identity, Auth or business rows.
  const catalog=JSON.parse(sharedCanonicalCatalog(sql));
  mkdirSync(new URL('../../test-results/',import.meta.url),{recursive:true});
  writeFileSync(new URL('../../test-results/shared-canonical-catalog.json',import.meta.url),JSON.stringify(catalog,null,2)+'\n');
  pass('all five exact canonical migrations apply; only the guarded synthetic legacy account becomes Admin Lead');
  const fabrication = '44180000-0000-4000-8000-000000000001', software = '44180000-0000-4000-8000-000000000003';
  sql(`update public.profiles set primary_area_id=${lit(fabrication)} where id in (${lit(lead.id)},${lit(adminLead.id)});`);
  pass('actual Inventory signup trigger ignores role/active/admin claims in user-controlled Auth metadata');

  const beforeRoles = profilesState();
  for (const actor of [student, lead, adminLead, legacy, reader, inactive, manager]) {
    await rejected(await request(`/rest/v1/profiles?id=eq.${actor.id}`, { role: 'admin', active: true }, actor, 'PATCH'));
    await rejected(await rpc('team_invitation_finish', { invitation_id: randomUUID(), invited_user: actor.id }, actor));
  }
  await rejected(await rpc('team_invitation_finish', { invitation_id: randomUUID(), invited_user: student.id }, null), /permission/i, 401);
  for (const actor of [student, lead, adminLead, legacy, reader, inactive]) {
    await rejected(await rpc('team_manage', { action: 'member', p: { user_id: actor.id, role: 'admin', reason: 'Synthetic escalation attempt' } }, actor), /Mentor/i);
    await rejected(await rpc('team_manage_v2', { action: 'member_state', p: { user_id: actor.id, active: true, reason: 'Synthetic escalation attempt' } }, actor), /Mentor/i);
  }
  assert.equal(profilesState(), beforeRoles);
  for (const role of ['anon', 'authenticated']) assert.equal(sql(`select has_function_privilege(${lit(role)},'public.team_invitation_finish(uuid,uuid)','EXECUTE')`), 'f');
  assert.equal(sql("select has_function_privilege('service_role','public.team_invitation_finish(uuid,uuid)','EXECUTE')"), 't');
  pass('direct profile escalation and Team Hub management bypasses fail; invitation completion is service-only even for a mentor session');

  await json(await request('/auth/v1/user', { data: { role: 'admin', active: true, permissions: ['*'] } }, student, 'PUT'));
  await rejected(await rpc('team_manage_v2', { action: 'create_area', p: { name: 'Synthetic forbidden', slug: 'forbidden', reason: 'Test' } }, student), /Mentor/i);
  assert.equal(profilesState(), beforeRoles);
  const self = profile(manager);
  await rejected(await rpc('team_manage', { action: 'member', p: { user_id: manager.id, display_name: self.display_name, role: 'admin_lead', active: true, primary_area_id: null,
    expected_updated_at: self.updated_at, expected_member_status: null, expected_team_area: null, member_status: null, reason: 'Synthetic self escalation' } }, manager), /another mentor/);
  assert.equal(profilesState(), beforeRoles);
  pass('editing Auth metadata does not change shared authorization; mentor self-role changes retain their existing guard');

  for(const actor of [student,lead,adminLead,legacy]){
    const finance=await json(await rpc('finance_context',{},actor));
    assert.equal(finance.profile.role,profile(actor).role);assert.equal(finance.can_create,true);assert.equal(finance.is_admin,false);
    assert.deepEqual(finance.capabilities,actor===adminLead||actor===legacy?['school_submitter']:[]);
  }
  const readOnlyFinance=await json(await rpc('finance_context',{},reader));
  assert.equal(readOnlyFinance.can_create,false);assert.deepEqual(readOnlyFinance.capabilities,[]);
  pass('Finance accepts genuine student requests; Admin Lead/converted account gets school-submit capability, not approval or administration; Readonly gets no write capability');

  const invitationID = randomUUID(), inviteeName = `invited-${randomUUID()}`;
  const inviteEmail = `shared-security-${inviteeName}@example.invalid`;
  const invite = { id: invitationID, email: inviteEmail, display_name: 'Synthetic invited student', role: 'student', member_status: 'prospective', reason: 'Synthetic authorized onboarding' };
  await rejected(await rpc('team_invitation_reserve', { p: { ...invite, role: 'admin' } }, adminLead), /retired|students only/i);
  await rejected(await rpc('team_invitation_reserve', { p: invite }, student), /Active Admin Lead/);
  assert.equal((await json(await rpc('team_invitation_reserve', { p: invite }, adminLead))).send, true);
  await rejected(await rpc('team_invitation_reserve',{p:{...invite,id:randomUUID(),email:'denied-lead@example.invalid'}},lead),/Active Admin Lead/);
  const password = `Synthetic-${randomBytes(24).toString('hex')}!`; registerSecret(password);
  const created = await json(await request('/auth/v1/signup', { email: inviteEmail, password, data: { team_invitation_id: invitationID, role: 'admin' } }));
  assert(created.user?.id && created.access_token); registerSecret(created.access_token); if (created.refresh_token) registerSecret(created.refresh_token);
  const invited = { id: created.user.id, token: created.access_token };
  assert.equal(profile(invited).role, 'readonly'); assert.equal(profile(invited).active, false);
  sql(`update auth.users set invited_at=clock_timestamp() where id=${lit(invited.id)};`);
  await rejected(await rpc('team_invitation_finish', { invitation_id: invitationID, invited_user: invited.id }, lead));
  assert.equal(profile(invited).active, false);
  await json(await localFetch(base, '/rest/v1/rpc/team_invitation_finish', { method: 'POST', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ invitation_id: invitationID, invited_user: invited.id }) }));
  assert.equal(profile(invited).role, 'student'); assert.equal(profile(invited).active, true);
  assert.equal(sql(`select actor_id from team_private.management_history where user_id=${lit(invited.id)} and action='member_invited'`), adminLead.id);
  const membershipAudit=()=>query(`select coalesce(jsonb_agg(performed_by order by id),'[]'::jsonb) from public.team_attendance_history where student_id=${lit(invited.id)} and entity='team_attendance_members'`);
  assert.deepEqual(membershipAudit(),[adminLead.id],'Actual service completion attributes membership to the validated inviter');
  await json(await localFetch(base, '/rest/v1/rpc/team_invitation_finish', { method: 'POST', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ invitation_id: invitationID, invited_user: invited.id }) }));
  assert.deepEqual(membershipAudit(),[adminLead.id],'Provisioned service replay must not duplicate membership audit');
  pass('allowed Admin Lead student invitations remain quarantined until actual service-role completion; no client can finish its own elevation');

  assert.equal(profile(student).role,'student');assert.equal(profile(student).primary_area_id,null);
  assert.equal(sql(`select count(*) from public.team_member_positions where user_id=${lit(student.id)}`),'0');
  const studentItem=randomUUID();await json(await request('/rest/v1/inventory_items',{id:studentItem,name:'Synthetic Student-created item',area_id:fabrication,category:'Test',quantity:3},student));
  assert.equal((await read('inventory_items',`id=eq.${studentItem}`,student))[0].created_by,student.id);
  pass('genuine Student with no area or position creates eligible-area stock through raw API');

  const itemA = randomUUID(), itemB = randomUUID();
  for (const [id, area_id] of [[itemA, fabrication], [itemB, software]]) await json(await request('/rest/v1/inventory_items', { id, name: 'Synthetic security item', area_id, category: 'Test', quantity: 10 }, manager));
  const inventoryTables = ['inventory_items', 'inventory_events', 'inventory_balances', 'inventory_movements', 'trips'];
  const inventoryBefore = fingerprint(inventoryTables);
  for(const actor of [reader,inactive]){
    const response=await request(`/rest/v1/inventory_items?id=eq.${itemA}`, { name: 'Denied metadata' }, actor, 'PATCH');
    if(response.status===200)assert.deepEqual(await response.json(),[],'RLS-filtered UPDATE changes no rows');
    else await rejected(response,/permission|metadata|read/i);
  }
  const noStudentDelete=await request(`/rest/v1/inventory_items?id=eq.${itemA}`,undefined,student,'DELETE');
  if(noStudentDelete.status===200)assert.deepEqual(await noStudentDelete.json(),[],'Student editing never grants unrestricted deletion');
  else await rejected(noStudentDelete);
  for (const actor of [student, lead, adminLead, legacy, reader, inactive]) {
    await rejected(await request('/rest/v1/inventory_events', { inventory_item_id: itemA, item_name: 'Forged event', user_id: manager.id, event_type: 'item_updated' }, actor));
    await rejected(await request(`/rest/v1/inventory_balances?inventory_item_id=eq.${itemA}`, { quantity: 999 }, actor, 'PATCH'));
    await rejected(await rpc('inventory_action', { p_action: 'create_trip', p_data: { name: 'Forbidden trip' } }, actor), /permission|mentor/i);
  }
  await rejected(await rpc('change_inventory_quantity', { p_id: itemA, p_delta: 1 }, null), /permission/i, 401);
  assert.equal(fingerprint(inventoryTables), inventoryBefore);
  pass('Inventory rejects Readonly/inactive metadata writes, forged audit/balance writes, anonymous counting, and unauthorized trip administration');

  const counted = await json(await rpc('change_inventory_quantity', { p_id: itemA, p_delta: 1 }, student));
  assert.equal(counted.item.quantity, 11); assert.equal(counted.item.updated_by, student.id);
  for(const actor of [student,lead,adminLead,legacy])for(const item of [itemA,itemB]){
    await json(await request(`/rest/v1/inventory_items?id=eq.${item}`, { name: `Synthetic cross-area edit ${actor.id}` }, actor, 'PATCH'));
    assert.equal((await read('inventory_items',`id=eq.${item}`,actor))[0].updated_by,actor.id);
  }
  const rpcRecord=(await read('inventory_items',`id=eq.${itemB}`,student))[0];
  await json(await rpc('apply_inventory_changes',{p_changes:{items:[{record:{...rpcRecord,notes:'Synthetic Student RPC metadata'},expected_updated_at:rpcRecord.updated_at}]}},student));
  assert.equal((await read('inventory_items',`id=eq.${itemB}`,student))[0].notes,'Synthetic Student RPC metadata');
  const trip = await json(await rpc('inventory_action', { p_action: 'create_trip', p_data: { name: 'Synthetic authorized trip' } }, manager));
  assert(trip.id);
  pass('genuine Student, Lead, Admin Lead and converted account edit both areas with authentic attribution; Mentor alone administers trips');

  await json(await request(`/rest/v1/inventory_items?id=eq.${itemA}`, {name:'Synthetic Admin Lead own-area edit'},adminLead,'PATCH'));
  for(const actor of [student,reader,inactive])await rejected(await rpc('inventory_action',{p_action:'create_location',p_data:{name:'Denied non-lead location',classification:'permanent',kind:'Box',areaId:software}},actor),/permission|lead/i);
  for(const actor of [lead,adminLead,legacy]){
    assert.equal((await json(await rpc('inventory_location_creation_context',{},actor))).can_create,true);
    assert.equal(sql(`select count(*) from team_member_positions where user_id=${lit(actor.id)}`),'0');
    await json(await rpc('inventory_action',{p_action:'create_location',p_data:{name:`Synthetic cross-area lead location ${actor.id}`,classification:'permanent',kind:'Box',areaId:software}},actor));
  }
  await rejected(await rpc('inventory_action',{p_action:'create_trip',p_data:{name:'Denied'}},adminLead),/mentor/i);
  pass('Lead and Admin Lead create cross-area locations without a named position; Students cannot create locations and Admin Lead cannot administer trips');

  // The complete released foundations already seed this exact recognized key.
  assert.deepEqual(query("select jsonb_build_object('key',key,'active',active,'category',category) from team_positions where key='software_lead'"),{key:'software_lead',active:true,category:'Functional Leads'});
  await json(await rpc('team_manage',{action:'assign_position',p:{user_id:adminLead.id,position_key:'software_lead',reason:'Synthetic assignment'}},manager));
  assert.equal((await json(await rpc('inventory_location_creation_context',{},adminLead))).assigned_lead,true);
  const storage=await json(await rpc('inventory_action',{p_action:'create_location',p_data:{name:'Synthetic assigned Admin Lead storage',classification:'permanent',kind:'Box',areaId:software}},adminLead));
  const location=(await read('locations',`id=eq.${storage.id}`,adminLead))[0];
  await json(await rpc('inventory_action',{p_action:'rename_location',p_data:{id:storage.id,name:'Synthetic name-only rename',updatedAt:location.updated_at}},adminLead));
  sql(`update public.profiles set role='readonly' where id=${lit(adminLead.id)};`);
  const deniedState=fingerprint(inventoryTables);
  assert.equal((await json(await rpc('inventory_location_creation_context',{},adminLead))).assigned_lead,false);
  await rejected(await rpc('change_inventory_quantity',{p_id:itemA,p_delta:1},adminLead),/permission/i);
  await rejected(await rpc('inventory_action',{p_action:'create_location',p_data:{name:'Denied retained position',classification:'permanent'}},adminLead),/permission/i);
  assert.equal(sql(`select count(*) from public.team_member_positions where user_id=${lit(adminLead.id)} and revoked_at is null`),'1');
  assert.equal(fingerprint(inventoryTables),deniedState);sql(`update public.profiles set role='admin_lead' where id=${lit(adminLead.id)};`);
  pass('real named-position Admin Lead can create/name-only rename; Readonly immediately wins over retained area/position with same JWT');

  const eventPayload = { name: 'Synthetic API security event', start_date: '2026-10-14', end_date: '2026-10-14' };
  const eventID = await json(await rpc('pit_save_event', { p: eventPayload }, manager));
  await json(await rpc('pit_activate_event', { p: { id: eventID } }, manager));
  const pitBefore = fingerprint(['pit_events', 'pit_issues', 'pit_batteries', 'pit_issue_events', 'pit_battery_events']);
  for (const actor of [student, lead, adminLead, legacy, reader, inactive]) {
    await rejected(await rpc('pit_save_event', { p: eventPayload }, actor), /Insufficient Pit/);
    await rejected(await rpc('pit_save_battery', { p: { battery_number: 'B999' } }, actor), /Insufficient Pit/);
    await rejected(await request(`/rest/v1/pit_events?id=eq.${eventID}`, { status: 'completed' }, actor, 'PATCH'));
    await rejected(await request('/rest/v1/pit_issue_events', { issue_id: randomUUID(), performed_by: manager.id, changes: {} }, actor));
  }
  const issue = { event_id: eventID, subsystem: 'Software', severity: 'LOW', description: 'Synthetic direct API issue', reported_by: manager.id };
  for (const actor of [reader, inactive]) await rejected(await rpc('pit_report_issue', { p: issue }, actor), /Insufficient Pit/);
  await rejected(await rpc('pit_report_issue', { p: issue }, null), /permission/i, 401);
  assert.equal(fingerprint(['pit_events', 'pit_issues', 'pit_batteries', 'pit_issue_events', 'pit_battery_events']), pitBefore);
  const issueID = await json(await rpc('pit_report_issue', { p: issue }, student));
  assert.equal((await read('pit_issues', `id=eq.${issueID}`, student))[0].reported_by, student.id);
  assert.equal(sql(`select performed_by from public.pit_issue_events where issue_id=${lit(issueID)}`), student.id);
  await rejected(await rpc('pit_update_issue', { p: { id: issueID, status: 'RESOLVED' } }, student), /Insufficient Pit/);
  pass('Pit blocks client table/audit writes and unauthorized administrative RPCs; student issue reporting binds actor to the real token');

  // Actual PostgreSQL row-lock waits via raw HTTP RPC, no trigger injection or sleeps.
  const home=randomUUID(),destination=randomUUID(),lockedItem=randomUUID();
  await json(await request('/rest/v1/locations',{id:home,name:'Synthetic race home',location_type:'Drawer'},manager));
  await json(await request('/rest/v1/locations',{id:destination,name:'Synthetic race destination',location_type:'Storage'},manager));
  await json(await request('/rest/v1/inventory_items',{id:lockedItem,name:'Synthetic concurrency item',area_id:fabrication,category:'Test',quantity:10,location_id:home},manager));
  const raceFailures=[];
  for(const change of ['readonly','inactive'])for(const operation of ['count','move','verify']){
    sql(`update public.profiles set role='student',active=true where id=${lit(student.id)};`);
    const stable=fingerprint(inventoryTables);
    const expected=query(`select jsonb_agg(jsonb_build_object('id',id,'updated_at',updated_at)) from inventory_items where location_id=${lit(home)}`);
    const release=await gate({inventoryItem:lockedItem});let pending;
    try {
      pending=operation==='count'?rpc('change_inventory_quantity',{p_id:lockedItem,p_delta:1},student):operation==='move'?rpc('inventory_action',{p_action:'move',p_data:{itemId:lockedItem,from:home,to:destination,quantity:1}},student):rpc('verify_balance_location',{p_location:home,p_expected:expected},student);
      const functionName=operation==='count'?'change_inventory_quantity':operation==='move'?'inventory_action':'verify_balance_location';
      await waitFor(()=>sql(`select count(*) from pg_stat_activity where wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0 and query like '%${functionName}%'`) !== '0',`real ${operation} RPC blocked on synthetic item`);
      sql(`update public.profiles set ${change==='readonly'?"role='readonly'":'active=false'} where id=${lit(student.id)};`);
    } finally {await release();}
    const response=await pending;let denied=false,unchanged=false;
    try{await rejected(response,/permission|cannot change inventory|audit/i);denied=true;}catch(error){raceFailures.push({operation,change,invariant:'403 permission denial',message:error.message});}
    try{assert.equal(fingerprint(inventoryTables),stable);unchanged=true;}catch{raceFailures.push({operation,change,invariant:'no writes',message:'Inventory state or audit fingerprint changed'});}
    if(denied&&unchanged)pass(`native ${operation} denies ${change} after actual row-lock wait with identical JWT and no writes`);
    else console.error(`FAIL native ${operation}/${change}: HTTP ${response.status}, no-writes=${unchanged}`);
  }
  assert.equal(raceFailures.length,0,JSON.stringify(raceFailures));
  sql(`update public.profiles set role='student',active=true where id=${lit(student.id)};`);
  const release=await gate({inventoryItem:lockedItem});const positive=rpc('change_inventory_quantity',{p_id:lockedItem,p_delta:1},student);
  try{await waitFor(()=>sql("select count(*) from pg_stat_activity where wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0 and query like '%change_inventory_quantity%'")!=='0','positive control blocked');}finally{await release();}
  assert.equal((await json(await positive)).item.quantity,11);pass('authorized native stock write still succeeds after the same real lock wait');

  // Additional metadata RPC regression: a permitted save cannot report success
  // after a real lock wait downgrades the same token to Readonly/inactive.
  for(const change of ['readonly','inactive']){
    sql(`update public.profiles set role='student',active=true where id=${lit(student.id)}`);
    const record=(await read('inventory_items',`id=eq.${itemA}`,student))[0];
    const stable=fingerprint(inventoryTables);const releaseMetadata=await gate({inventoryItem:itemA});let pendingMetadata;
    try{
      pendingMetadata=rpc('apply_inventory_changes',{p_changes:{items:[{record:{...record,notes:'Must not falsely succeed'},expected_updated_at:record.updated_at}]}},student);
      await waitFor(()=>sql("select count(*) from pg_stat_activity where wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0 and query like '%apply_inventory_changes%'")!=='0','real metadata RPC row wait');
      sql(`update public.profiles set ${change==='readonly'?"role='readonly'":'active=false'} where id=${lit(student.id)}`);
    }finally{await releaseMetadata();}
    await rejected(await pendingMetadata,/cannot change inventory/i);assert.equal(fingerprint(inventoryTables),stable);
    pass(`metadata RPC rejects ${change} after real row wait without false success or writes`);
  }
  sql(`update public.profiles set role='student',active=true where id=${lit(student.id)}`);

  await json(await rpc('change_inventory_quantity', { p_id: itemA, p_delta: 0 }, lead));
  await json(await rpc('pit_report_issue', { p: issue }, lead));
  assert.equal((await json(await rpc('team_invitation_reserve', { p: invite }, adminLead))).send, false);
  const inventoryStable = fingerprint(inventoryTables), pitStable = fingerprint(['pit_events', 'pit_issues', 'pit_batteries', 'pit_issue_events', 'pit_battery_events']);
  sql(`update public.profiles set active=false where id=${lit(lead.id)};`);
  await rejected(await rpc('change_inventory_quantity', { p_id: itemA, p_delta: 1 }, lead), /permission/i);
  await rejected(await rpc('pit_report_issue', { p: issue }, lead), /Insufficient Pit/);
  await rejected(await rpc('finance_context',{},lead),/Active team account/);
  await rejected(await rpc('team_invitation_reserve', { p: { ...invite, id: randomUUID(), email: `disabled-${randomUUID()}@example.invalid` } }, lead), /Active Admin Lead/);
  assert.equal(fingerprint(inventoryTables), inventoryStable); assert.equal(fingerprint(['pit_events', 'pit_issues', 'pit_batteries', 'pit_issue_events', 'pit_battery_events']), pitStable);
  assert.equal(sql("select pg_get_functiondef('auth.uid()'::regprocedure)"), authFunction);
  assert.equal(sql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity"), '0');
  pass('one shared-profile deactivation immediately revokes all four apps with the SAME JWT; exposed fixture tables keep RLS enabled');
  return checks;
}
