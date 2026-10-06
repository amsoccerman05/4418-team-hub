import type {OutreachContext,OutreachEntity,SavePayload} from './types';

/** UI affordances follow explicit server capabilities, never owner visibility. */
export function canOpenEditor(ctx:OutreachContext,entity:OutreachEntity|'income_link',initial:Record<string,unknown>={}) {
  const creating=!initial.version;
  const org=ctx.organizations.find(o=>o.id===(entity==='organization'?initial.id:initial.organization_id));
  const engagement=ctx.engagements.find(e=>e.id===(entity==='engagement'?initial.id:initial.engagement_id));
  const seasonOpen=!!ctx.season_id&&ctx.seasons.some(s=>s.id===ctx.season_id&&s.status!=='closed');
  if(entity==='prospect')return creating&&ctx.can_create_prospect&&seasonOpen;
  if(entity==='organization')return creating?ctx.can_manage:!!org?.active&&org.can_edit;
  if(entity==='contact')return creating?!!org?.active&&org.can_add_contact:!!ctx.contacts.find(c=>c.id===initial.id&&c.active&&c.can_edit);
  if(entity==='engagement')return seasonOpen&&(creating?!!org?.active&&org.can_create_engagement:!!engagement?.can_edit);
  if(entity==='conversation')return creating&&seasonOpen&&!!engagement?.can_log;
  if(entity==='income_link'){const pledge=ctx.pledges.find(p=>p.id===initial.pledge_id);return ctx.can_manage&&ctx.can_link_finance&&seasonOpen&&pledge?.kind==='cash'&&pledge.status==='pledged';}
  return ctx.can_manage&&!ctx.financials_redacted&&seasonOpen&&!!engagement&&ctx.organizations.some(o=>o.id===engagement.organization_id&&o.active);
}

/** Redacted fields are omitted, not submitted as empty replacements. */
export function buildOutreachPayload(entity:OutreachEntity,initial:SavePayload,ctx:OutreachContext,fields:Record<string,string>):SavePayload {
  const value=(key:string)=>(fields[key]||'').trim(),nullable=(key:string)=>value(key)||null;
  let values:Record<string,unknown>={};
  if(entity==='prospect')values={kind:value('kind'),name:value('name'),website:value('website'),engagement_id:initial.engagement_id,season_id:ctx.season_id,next_follow_up_on:nullable('next_follow_up_on')};
  if(entity==='organization')values={kind:value('kind'),name:value('name'),website:value('website'),...(ctx.can_manage?{notes:value('notes'),active:initial.active??true}:{})};
  if(entity==='contact')values={organization_id:initial.organization_id,name:value('name'),title:value('title'),email:value('email'),phone:value('phone'),...(ctx.can_manage?{notes:value('notes'),active:initial.active??true}:{})};
  if(entity==='engagement')values={organization_id:initial.organization_id,season_id:ctx.season_id,stage:value('stage'),next_follow_up_on:nullable('next_follow_up_on'),...(ctx.can_manage?{owner_id:nullable('owner_id'),notes:value('notes')}:{})};
  if(entity==='conversation')values={engagement_id:initial.engagement_id,contact_id:nullable('contact_id'),occurred_on:value('occurred_on'),channel:value('channel'),summary:value('summary')};
  if(entity==='pledge')values={engagement_id:initial.engagement_id,kind:value('kind'),amount:value('kind')==='cash'?Number(value('amount')):null,description:value('description'),promised_on:value('promised_on'),expected_on:nullable('expected_on'),status:value('status')};
  if(entity==='recognition')values={engagement_id:initial.engagement_id,pledge_id:nullable('pledge_id'),owner_id:nullable('owner_id'),kind:value('kind'),description:value('description'),due_on:nullable('due_on'),status:value('status'),fulfilled_on:value('status')==='fulfilled'?nullable('fulfilled_on'):null,fulfillment_note:value('fulfillment_note')};
  return {id:initial.id,version:initial.version,...values};
}
