// Genuine Auth + raw PostgREST tests against one OWNED, empty local stack.
// Representative cross-site boundaries use exact pinned source migrations.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { localFetch, localURL, ORIGIN, API_PORT } from './fabrication-safety.mjs';
import { installSharedSecurityFixture } from './shared-security-fixture.mjs';
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
  const adminLead=await signup('admin-lead','admin_lead');
  const lead = await signup('lead', 'lead'), reader = await signup('reader'), inactive = await signup('inactive', 'student', false);
  const fabrication = '44180000-0000-4000-8000-000000000001', software = '44180000-0000-4000-8000-000000000003';
  sql(`update public.profiles set primary_area_id=${lit(fabrication)} where id in (${lit(lead.id)},${lit(adminLead.id)});`);
  pass('actual Inventory signup trigger ignores role/active/admin claims in user-controlled Auth metadata');

  const beforeRoles = profilesState();
  for (const actor of [student, lead, adminLead, reader, inactive, manager]) {
    await rejected(await request(`/rest/v1/profiles?id=eq.${actor.id}`, { role: 'admin', active: true }, actor, 'PATCH'));
    await rejected(await rpc('team_invitation_finish', { invitation_id: randomUUID(), invited_user: actor.id }, actor));
  }
  await rejected(await rpc('team_invitation_finish', { invitation_id: randomUUID(), invited_user: student.id }, null), /permission/i, 401);
  for (const actor of [student, lead, adminLead, reader, inactive]) {
    await rejected(await rpc('team_manage', { action: 'member', p: { user_id: actor.id, role: 'admin', reason: 'Synthetic escalation attempt' } }, actor), /mentor or admin/);
    await rejected(await rpc('team_manage_v2', { action: 'member_state', p: { user_id: actor.id, active: true, reason: 'Synthetic escalation attempt' } }, actor), /mentor or admin/);
  }
  assert.equal(profilesState(), beforeRoles);
  for (const role of ['anon', 'authenticated']) assert.equal(sql(`select has_function_privilege(${lit(role)},'public.team_invitation_finish(uuid,uuid)','EXECUTE')`), 'f');
  assert.equal(sql("select has_function_privilege('service_role','public.team_invitation_finish(uuid,uuid)','EXECUTE')"), 't');
  pass('direct profile escalation and Team Hub management bypasses fail; invitation completion is service-only even for a mentor session');

  await json(await request('/auth/v1/user', { data: { role: 'admin', active: true, permissions: ['*'] } }, student, 'PUT'));
  await rejected(await rpc('team_manage_v2', { action: 'create_area', p: { name: 'Synthetic forbidden', slug: 'forbidden', reason: 'Test' } }, student), /mentor or admin/);
  assert.equal(profilesState(), beforeRoles);
  const self = profile(manager);
  await rejected(await rpc('team_manage', { action: 'member', p: { user_id: manager.id, display_name: self.display_name, role: 'admin', active: true, primary_area_id: null,
    expected_updated_at: self.updated_at, expected_member_status: null, expected_team_area: null, member_status: null, reason: 'Synthetic self escalation' } }, manager), /another mentor/);
  assert.equal(profilesState(), beforeRoles);
  pass('editing Auth metadata does not change shared authorization; mentor self-role changes retain their existing guard');

  const invitationID = randomUUID(), inviteeName = `invited-${randomUUID()}`;
  const inviteEmail = `shared-security-${inviteeName}@example.invalid`;
  const invite = { id: invitationID, email: inviteEmail, display_name: 'Synthetic invited student', role: 'student', member_status: 'prospective', reason: 'Synthetic authorized onboarding' };
  await rejected(await rpc('team_invitation_reserve', { p: { ...invite, role: 'admin' } }, adminLead), /students only/);
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
  await rejected(await request(`/rest/v1/inventory_items?id=eq.${itemA}`, { name: 'Unauthorized metadata' }, student, 'PATCH'), /assigned lead|metadata/);
  await rejected(await request(`/rest/v1/inventory_items?id=eq.${itemB}`, { name: 'Wrong-area edit' }, lead, 'PATCH'), /assigned lead|metadata/);
  for (const actor of [student, lead, adminLead, reader, inactive]) {
    await rejected(await request('/rest/v1/inventory_events', { inventory_item_id: itemA, item_name: 'Forged event', user_id: manager.id, event_type: 'item_updated' }, actor));
    await rejected(await request(`/rest/v1/inventory_balances?inventory_item_id=eq.${itemA}`, { quantity: 999 }, actor, 'PATCH'));
    await rejected(await rpc('inventory_action', { p_action: 'create_trip', p_data: { name: 'Forbidden trip' } }, actor), /permission|admins and mentors/i);
  }
  await rejected(await rpc('change_inventory_quantity', { p_id: itemA, p_delta: 1 }, null), /permission/i, 401);
  assert.equal(fingerprint(inventoryTables), inventoryBefore);
  pass('Inventory rejects student metadata changes, wrong-area lead edits, forged audit/balance writes, anonymous counting, and unauthorized trip administration');

  const counted = await json(await rpc('change_inventory_quantity', { p_id: itemA, p_delta: 1 }, student));
  assert.equal(counted.item.quantity, 11); assert.equal(counted.item.updated_by, student.id);
  await json(await request(`/rest/v1/inventory_items?id=eq.${itemA}`, { name: 'Synthetic own-area lead edit' }, lead, 'PATCH'));
  const trip = await json(await rpc('inventory_action', { p_action: 'create_trip', p_data: { name: 'Synthetic authorized trip' } }, manager));
  assert(trip.id);
  pass('existing student quantity counting, assigned-lead metadata edits, and mentor trip creation still work with authentic attribution');

  await json(await request(`/rest/v1/inventory_items?id=eq.${itemA}`, {name:'Synthetic Admin Lead own-area edit'},adminLead,'PATCH'));
  await rejected(await request(`/rest/v1/inventory_items?id=eq.${itemB}`,{name:'Denied cross-area edit'},adminLead,'PATCH'),/assigned lead|metadata/);
  await rejected(await rpc('inventory_action',{p_action:'create_trip',p_data:{name:'Denied'}},adminLead),/admins and mentors/);
  pass('Admin Lead retains own-area metadata but no cross-area or trip administration');

  await json(await rpc('team_manage_v2',{action:'position_save',p:{create:true,key:'software_lead',name:'Software Lead',description:'Synthetic functional role',category:'Functional Leads',display_order:10,reason:'Synthetic named-position prerequisite'}},manager));
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
  for (const actor of [student, lead, adminLead, reader, inactive]) {
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

  await json(await rpc('change_inventory_quantity', { p_id: itemA, p_delta: 0 }, lead));
  await json(await rpc('pit_report_issue', { p: issue }, lead));
  assert.equal((await json(await rpc('team_invitation_reserve', { p: invite }, adminLead))).send, false);
  const inventoryStable = fingerprint(inventoryTables), pitStable = fingerprint(['pit_events', 'pit_issues', 'pit_batteries', 'pit_issue_events', 'pit_battery_events']);
  sql(`update public.profiles set active=false where id=${lit(lead.id)};`);
  await rejected(await rpc('change_inventory_quantity', { p_id: itemA, p_delta: 1 }, lead), /permission/i);
  await rejected(await rpc('pit_report_issue', { p: issue }, lead), /Insufficient Pit/);
  await rejected(await rpc('team_invitation_reserve', { p: { ...invite, id: randomUUID(), email: `disabled-${randomUUID()}@example.invalid` } }, lead), /Active Admin Lead/);
  assert.equal(fingerprint(inventoryTables), inventoryStable); assert.equal(fingerprint(['pit_events', 'pit_issues', 'pit_batteries', 'pit_issue_events', 'pit_battery_events']), pitStable);
  assert.equal(sql("select pg_get_functiondef('auth.uid()'::regprocedure)"), authFunction);
  assert.equal(sql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity"), '0');
  pass('one shared-profile deactivation immediately revokes all three apps with the SAME JWT; exposed fixture tables keep RLS enabled');
  return checks;
}
